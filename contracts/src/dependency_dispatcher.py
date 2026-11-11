class DependencyDispatcher(gl.Contract):
    court: Address
    registry: Address
    nodes: TreeMap[str,str]
    reverse_entries: TreeMap[str,str]
    reverse_counts: TreeMap[str,u64]
    certificates: TreeMap[str,str]
    cursors: TreeMap[str,u64]
    notices: TreeMap[str,str]
    acknowledgements: TreeMap[str,str]
    accepted: TreeMap[str,str]
    history: DynArray[str]
    operation_inputs: TreeMap[str,str]
    proposition_schemas: TreeMap[str,str]
    delivered: TreeMap[str,str]

    def __init__(self, court: str, registry: str):
        self.court=Address(court);self.registry=Address(registry)

    def _reverse_add(self, ref, dependency):
        count=int(self.reverse_counts.get(ref,u64(0)))
        self.reverse_entries[ref+':'+str(count)]=dependency
        self.reverse_counts[ref]=u64(count+1)

    @gl.public.write
    def register_dependency(self, request: str) -> None:
        value=envelope(record(request));require_sender(value['consumer']);require_live(value)
        identifier(value['dependency_id']);bounded_int(value['rank'],1,2**32-1)
        parents=value['parents'];refs=value['references']
        if not isinstance(parents,list) or len(parents)>MAX_PARENTS or len(set(parents))!=len(parents):fail('Parent limit')
        if not isinstance(refs,list) or not 1<=len(refs)<=MAX_PROPOSITIONS:fail('Reference limit')
        inherited={}
        for parent_id in parents:
            parent=json.loads(self.nodes[parent_id])
            if parent['rank']>=value['rank']:fail('Backward or cyclic edge')
            if parent['policy_id']!=value['policy_id'] or parent['policy_revision']!=value['policy_revision']:fail('Parent policy mismatch')
            for ref in parent['ancestors']:
                inherited[source_ref(ref['revision'],ref['proposition'])]=ref
        manifests=[]
        for ref in refs:
            m=gl.get_contract_at(self.registry).view().get_revision(ref['revision'])
            if ref['span'] not in [s['id'] for s in m['spans']]:fail('Missing dependency span')
            definition=ref['definition']
            if definition['id']!=ref['proposition'] or definition['old_span']!=ref['span'] or definition['new_span']!=ref['span']:fail('Registered proposition span mismatch')
            if not 1<=len(definition['statement'])<=1000 or not 1<=len(definition['materiality_question'])<=1000:fail('Materiality question limit')
            immutable_put(self.proposition_schemas,source_ref(ref['revision'],ref['proposition']),{'definition':definition,'policy_id':value['policy_id'],'policy_revision':value['policy_revision']})
            if m not in manifests:manifests.append(m)
            inherited[source_ref(ref['revision'],ref['proposition'])]=ref
        if value['source_manifest_digest']!=digest(manifests):fail('Dependency manifest mismatch')
        if len(inherited)>MAX_ANCESTORS:fail('Ancestor reference limit')
        node=dict(value,ancestors=[inherited[k] for k in sorted(inherited)],status='REGISTERED',decision_digest=digest(value),last_applied_generation=0)
        if self.operation_inputs.get(value['request_id'],''):
            immutable_put(self.operation_inputs,value['request_id'],value);return
        if self.nodes.get(value['dependency_id'],''):fail('Dependency already registered')
        immutable_put(self.operation_inputs,value['request_id'],value)
        self.nodes[value['dependency_id']]=canonical(node)
        for ref in node['ancestors']:
            self._reverse_add(source_ref(ref['revision'],ref['proposition']),value['dependency_id'])
        gl.get_contract_at(Address(value['consumer'])).emit(on='finalized').receive_binding(canonical(node))
        history_append(self.history,{'event':'DEPENDENCY_REGISTERED','dependency_id':value['dependency_id'],'rank':value['rank']})

    @gl.public.write
    def begin_quarantine(self, certificate: str) -> None:
        require_sender(str(self.court))
        cert=envelope(record(certificate,48000))
        request_id=cert['request_id']
        cert['status']='FINALIZED' if not cert['unresolved'] else 'UNRESOLVED'
        # The trusted court emitted this certificate on finalized. Full binding is retained.
        if not immutable_put(self.certificates,request_id,cert):return
        for p in cert['propositions']:
            self.cursors[request_id+':'+p['id']]=u64(0)
        history_append(self.history,{'event':'CERTIFICATE_FINALIZED','request_id':request_id,'generation':cert['generation'],'status':cert['status']})

    @gl.public.write
    def dispatch_page(self, request_id: str, proposition_id: str, expected_cursor: int, operation_id: str) -> dict:
        identifier(operation_id)
        inputs={'request_id':request_id,'proposition_id':proposition_id,'cursor':expected_cursor}
        if self.operation_inputs.get(operation_id,''):
            immutable_put(self.operation_inputs,operation_id,inputs)
            return {'status':'REPLAYED','cursor':int(self.cursors[request_id+':'+proposition_id])}
        cert=json.loads(self.certificates[request_id])
        if proposition_id not in [p['id'] for p in cert['propositions']]:fail('Proposition outside certificate')
        cursor_key=request_id+':'+proposition_id
        cursor=int(self.cursors[cursor_key])
        if cursor!=expected_cursor:fail('Cursor changed')
        ref=source_ref(cert['old_revision'],proposition_id)
        count=int(self.reverse_counts.get(ref,u64(0)))
        end=min(cursor+MAX_PAGE,count)
        for i in range(cursor,end):
            dependency_id=self.reverse_entries[ref+':'+str(i)]
            node=json.loads(self.nodes[dependency_id])
            notice_id=request_id+':'+proposition_id+':'+dependency_id
            decision=next((d for d in cert['decisions'] if d['proposition_id']==proposition_id),None)
            notice={'operation_id':notice_id,'dependency_id':dependency_id,'decision_digest':node['decision_digest'],'certificate':cert,'proposition_id':proposition_id,'action':decision['action'] if decision else 'UNRESOLVED','status':'BROADCAST'}
            self.notices[notice_id]=canonical(notice)
            # Persist the outbox before emission. Replay by operation ID is safe after a worker crash.
            gl.get_contract_at(Address(node['consumer'])).emit(on='finalized').receive_notice(canonical(notice))
        self.cursors[cursor_key]=u64(end)
        immutable_put(self.operation_inputs,operation_id,inputs)
        history_append(self.history,{'event':'PAGE_BROADCAST','request_id':request_id,'proposition_id':proposition_id,'operation_id':operation_id,'from':cursor,'to':end})
        return {'status':'COMPLETE' if end==count else 'PENDING','cursor':end,'total':count}

    @gl.public.write
    def replay_notice(self, operation_id: str) -> None:
        notice=json.loads(self.notices[operation_id]);node=json.loads(self.nodes[notice['dependency_id']])
        gl.get_contract_at(Address(node['consumer'])).emit(on='finalized').receive_notice(canonical(notice))

    @gl.public.write
    def acknowledge_generation(self, acknowledgement: str) -> None:
        ack=record(acknowledgement)
        node=json.loads(self.nodes[ack['dependency_id']]);require_sender(node['consumer'])
        notice=json.loads(self.notices[ack['notice_id']]);cert=notice['certificate']
        if ack['generation']!=cert['generation'] or ack['decision_digest']!=node['decision_digest'] or ack['dependency_id']!=notice['dependency_id'] or ack['certificate_digest']!=cert['certificate_digest']:
            fail('Acknowledgement binding mismatch')
        if ack['route'] not in ('QUARANTINED','REFRESHED'):fail('Unsupported remediation')
        try:
            self.validate_acknowledgement(acknowledgement)
        except gl.vm.UserError:
            gl.get_contract_at(Address(node['consumer'])).emit(on='finalized').receive_acknowledgement(canonical(dict(ack,delivery_status='REJECTED')))
            return
        replacement=json.loads(self.certificates[ack['replacement_certificate_id']])
        if not immutable_put(self.acknowledgements,ack['operation_id'],ack):return
        key=ack['dependency_id']+'/'+source_ref(cert['old_revision'],notice['proposition_id'])
        prior=json.loads(self.accepted.get(key,'{}'))
        if prior.get('generation',0)>ack['generation']:fail('Old acknowledgement')
        if prior.get('route')=='REFRESHED' and ack['route']=='QUARANTINED':fail('Refreshed route is terminal for this generation')
        self.accepted[key]=canonical({'generation':ack['generation'],'route':ack['route'],'replacement_revision':replacement['new_revision'],'proposition':notice['proposition_id']})
        if ack['route']=='REFRESHED':self._reverse_add(source_ref(replacement['new_revision'],notice['proposition_id']),ack['dependency_id'])
        node['last_applied_generation']=max(node['last_applied_generation'],ack['generation']);self.nodes[ack['dependency_id']]=canonical(node)
        gl.get_contract_at(Address(node['consumer'])).emit(on='finalized').receive_acknowledgement(canonical(ack))
        history_append(self.history,dict(ack,event='ACKNOWLEDGED'))

    @gl.public.view
    def validate_acknowledgement(self, acknowledgement: str) -> bool:
        ack=record(acknowledgement);node=json.loads(self.nodes[ack['dependency_id']])
        notice=json.loads(self.notices[ack['notice_id']]);cert=notice['certificate']
        if ack['generation']!=cert['generation'] or ack['decision_digest']!=node['decision_digest'] or ack['dependency_id']!=notice['dependency_id'] or ack['certificate_digest']!=cert['certificate_digest']:fail('Acknowledgement binding mismatch')
        if ack['route'] not in ('QUARANTINED','REFRESHED'):fail('Unsupported remediation')
        flag=gl.get_contract_at(self.court).view().get_flag(cert['old_revision'],notice['proposition_id'])
        if flag['generation']!=ack['generation']:fail('Superseded acknowledgement')
        replacement=json.loads(self.certificates[ack['replacement_certificate_id']])
        if replacement['policy_id']!=node['policy_id'] or replacement['policy_revision']!=node['policy_revision']:fail('Replacement policy mismatch')
        if ack['route']=='REFRESHED':
            successor=replacement['new_revision']
            for step in range(8):
                if successor==cert['new_revision']:break
                successor=gl.get_contract_at(self.registry).view().get_revision(successor).get('supersedes','')
                if not successor:fail('Replacement is not a successor')
            else:fail('Replacement successor chain limit')
            decision=next((d for d in replacement['decisions'] if d['proposition_id']==notice['proposition_id']),None)
            if replacement['unresolved'] or decision is None or decision['new_support']!='TRUE':fail('Replacement does not support consequence')
            new_flag=gl.get_contract_at(self.court).view().get_flag(replacement['new_revision'],notice['proposition_id'])
            if new_flag['status']!='CLEAR':fail('Replacement revision flagged')
        return True

    @gl.public.view
    def get_dependency(self, dependency_id: str) -> dict:
        node=json.loads(self.nodes[dependency_id]);issues=[]
        # Replacement chains are bounded. No recursive graph traversal and no scan of all nodes.
        for ancestor in node['ancestors']:
            revision=ancestor['revision'];proposition=ancestor['proposition']
            for step in range(8):
                flag=gl.get_contract_at(self.court).view().get_flag(revision,proposition)
                if flag['status']=='CLEAR':break
                accepted=json.loads(self.accepted.get(dependency_id+'/'+source_ref(revision,proposition),'{}'))
                if accepted.get('generation',0)!=flag['generation'] or accepted.get('route')!='REFRESHED':
                    issues.append({'revision':revision,'proposition':proposition,'generation':flag['generation'],'status':flag['status']});break
                revision=accepted['replacement_revision']
            else:
                issues.append({'revision':revision,'proposition':proposition,'status':'REPLACEMENT_CHAIN_LIMIT','generation':0})
        node['usable']=not issues;node['restrictions']=issues
        return node

    @gl.public.view
    def get_certificate(self, request_id: str) -> dict:
        return json.loads(self.certificates[request_id])

    @gl.public.view
    def get_proposition(self, revision: str, proposition: str) -> dict:
        return json.loads(self.proposition_schemas[source_ref(revision,proposition)])

    @gl.public.view
    def get_dispatch(self, request_id: str, proposition_id: str) -> dict:
        cert=json.loads(self.certificates[request_id]);ref=source_ref(cert['old_revision'],proposition_id)
        return {'cursor':int(self.cursors[request_id+':'+proposition_id]),'total':int(self.reverse_counts.get(ref,u64(0))),'certificate':cert}

    @gl.public.view
    def get_notice(self, operation_id: str) -> dict:
        value=json.loads(self.notices[operation_id]);node=json.loads(self.nodes[value['dependency_id']]);cert=value['certificate']
        value['status']='DELIVERED' if self.delivered.get(operation_id,'') else 'BROADCAST'
        value['acknowledgement']=json.loads(self.accepted.get(value['dependency_id']+'/'+source_ref(cert['old_revision'],value['proposition_id']),'{}'))
        return value

    @gl.public.view
    def get_history(self, offset: int, limit: int) -> dict:
        return history_page(self.history,offset,limit)

    @gl.public.write
    def confirm_delivery(self, operation_id: str) -> None:
        notice=json.loads(self.notices[operation_id]);node=json.loads(self.nodes[notice['dependency_id']])
        require_sender(node['consumer'])
        if not immutable_put(self.delivered,operation_id,{'consumer':node['consumer']}):return
        history_append(self.history,{'event':'NOTICE_DELIVERED','operation_id':operation_id,'dependency_id':node['dependency_id']})

    @gl.public.view
    def get_delivery_page(self, request_id: str, proposition_id: str, offset: int, limit: int) -> dict:
        bounded_int(offset,0,MAX_HISTORY);bounded_int(limit,1,MAX_PAGE)
        cert=json.loads(self.certificates[request_id]);ref=source_ref(cert['old_revision'],proposition_id)
        count=int(self.reverse_counts.get(ref,u64(0)));end=min(offset+limit,count)
        return {'items':[self.get_notice(request_id+':'+proposition_id+':'+self.reverse_entries[ref+':'+str(i)]) for i in range(offset,min(end,int(self.cursors[request_id+':'+proposition_id])))],'next':end,'total':count}
