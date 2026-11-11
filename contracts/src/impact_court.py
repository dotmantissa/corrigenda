class ImpactCourt(gl.Contract):
    owner: Address
    registry: Address
    dispatcher: Address
    requests: TreeMap[str,str]
    certificates: TreeMap[str,str]
    flags: TreeMap[str,str]
    history: DynArray[str]
    generation: u64
    attempts: TreeMap[str,u8]
    packet_digests: TreeMap[str,str]

    def __init__(self, registry: str):
        self.owner=gl.message.sender_address
        self.registry=Address(registry)

    @gl.public.write
    def bind_dispatcher(self, address: str) -> None:
        require_sender(str(self.owner))
        if self.dispatcher!=Address('0x'+'00'*20):
            if self.dispatcher!=Address(address):fail('Dispatcher already bound')
            return
        self.dispatcher=Address(address)

    @gl.public.write
    def open_correction(self, request: str) -> None:
        value=envelope(record(request))
        require_sender(value['owner']);require_live(value)
        existing=self.requests.get(value['request_id'],'')
        if existing:
            if json.loads(existing)['original_digest']!=digest(value):fail('Conflicting request ID reuse')
            return
        if value['generation']!=int(self.generation)+1:fail('Generation must be next')
        predecessor=value.get('supersedes_request','')
        if predecessor:
            identifier(predecessor)
            prior_request=json.loads(self.requests[predecessor])
            if prior_request['status'] not in ('UNRESOLVED','TIMEOUT'):fail('Only unresolved or timed out requests can recover')
            require_sender(prior_request['owner'])
            locked=[k for k in BINDINGS if k not in ('request_id','generation','deadline')]+['old_revision','new_revision','propositions']
            if any(prior_request[k]!=value[k] for k in locked):fail('Recovery changed locked request')
            if int(self.packet_digests.get(value['source_manifest_digest'],'0'))>=3:fail('Evidence retry limit; register successor evidence')
        props=value['propositions']
        if not isinstance(props,list) or not 1<=len(props)<=MAX_PROPOSITIONS:fail('Proposition limit')
        old=gl.get_contract_at(self.registry).view().get_revision(value['old_revision'])
        new=gl.get_contract_at(self.registry).view().get_revision(value['new_revision'])
        if old['source_id']!=new['source_id'] or new.get('supersedes')!=old['revision_id'] or old['authority_id']!=new['authority_id']:
            fail('Authentic successor pair required')
        manifests=[old,new]
        if value['source_manifest_digest']!=digest(manifests):fail('Manifest digest mismatch')
        if sum(m['byte_size'] for m in manifests)>MAX_PACKET_BYTES:fail('Complete packet byte limit')
        if any(m['byte_size']>MAX_TEXT_BYTES for m in manifests) or sum(m['byte_size'] for m in manifests)+len(canonical(value).encode())+len(canonical(manifests).encode())+2500>MAX_PROMPT_BYTES:fail('Complete assessment context limit')
        policy=gl.get_contract_at(self.registry).view().get_policy(value['policy_id'],value['policy_revision'])
        rules={r['id'] for r in policy['rules']}
        seen=set()
        for p in props:
            identifier(p['id'])
            registered=gl.get_contract_at(self.dispatcher).view().get_proposition(value['old_revision'],p['id'])
            if registered['definition']!=p or registered['policy_id']!=value['policy_id'] or registered['policy_revision']!=value['policy_revision']:fail('Locked proposition or materiality question changed')
            if p['id'] in seen:fail('Duplicate proposition')
            seen.add(p['id'])
            if not 1<=len(p['statement'])<=1000 or not 1<=len(p['materiality_question'])<=1000:fail('Proposition text limit')
            if set(p['rule_ids'])!=rules or len(p['rule_ids'])!=len(rules):fail('Complete policy rule coverage required')
            if p['old_span'] not in [s['id'] for s in old['spans']] or p['new_span'] not in [s['id'] for s in new['spans']]:fail('Missing controlling span')
            ref=source_ref(value['old_revision'],p['id'])
            prior=json.loads(self.flags.get(ref,'{}'))
            if prior.get('status')=='UNRESOLVED' and prior.get('request_id')!=predecessor:fail('Prior impact unresolved; recover it first')
            self.flags[ref]=canonical({'request_id':value['request_id'],'generation':value['generation'],'status':'UNRESOLVED','sticky':prior.get('sticky',False)})
        if predecessor:
            prior_request['status']='SUPERSEDED';prior_request['superseded_by']=value['request_id']
            self.requests[predecessor]=canonical(prior_request)
            history_append(self.history,{'event':'REQUEST_SUPERSEDED','request_id':predecessor,'superseded_by':value['request_id']})
        value=dict(value,original_digest=digest(value),status='PENDING',superseded_by='',manifests=manifests,policy=policy)
        self.requests[value['request_id']]=canonical(value)
        self.generation=u64(value['generation'])
        history_append(self.history,{'event':'CORRECTION_OPENED','request_id':value['request_id'],'generation':value['generation']})

    @gl.public.write
    def assess_impact(self, request_id: str) -> None:
        value=json.loads(self.requests[request_id])
        if value['status'] in ('ASSESSED','UNRESOLVED','TIMEOUT','SUPERSEDED'):return
        require_live(value)
        count=int(self.attempts.get(request_id,u8(0)))
        if count>=3:fail('Assessment retry limit; timeout recovery required')
        packet_attempts=int(self.packet_digests.get(value['source_manifest_digest'],'0'))
        if packet_attempts>=3:fail('Evidence retry limit; register successor evidence')
        self.packet_digests[value['source_manifest_digest']]=str(packet_attempts+1)
        self.attempts[request_id]=u8(count+1)
        result=assess_consensus(value)
        cert={k:value[k] for k in BINDINGS}
        cert.update(status=result['status'],decisions=result['decisions'],reason=result['reason'],coverage=len(result['decisions'])==len(value['propositions']),unresolved=result['status']=='UNRESOLVED',superseded_by='',old_revision=value['old_revision'],new_revision=value['new_revision'],propositions=value['propositions'],manifests=value['manifests'])
        cert['certificate_digest']=digest(cert)
        self.certificates[request_id]=canonical(cert)
        value['status']=result['status'];self.requests[request_id]=canonical(value)
        for p in value['propositions']:
            ref=source_ref(value['old_revision'],p['id']);flag=json.loads(self.flags[ref])
            if flag['generation']==value['generation']:
                decision=next((d for d in result['decisions'] if d['proposition_id']==p['id']),None)
                restriction=decision is None or decision['action']!='KEEP'
                flag['sticky']=flag['sticky'] or restriction
                flag['status']='QUARANTINED' if flag['sticky'] else 'CLEAR'
                if result['status']=='UNRESOLVED':flag['status']='UNRESOLVED'
                self.flags[ref]=canonical(flag)
        for decision in result['decisions']:
            if decision['new_support']!='TRUE' and decision['action']!='KEEP':
                new_ref=source_ref(value['new_revision'],decision['proposition_id'])
                self.flags[new_ref]=canonical({'request_id':value['request_id'],'generation':value['generation'],'status':'UNRESOLVED' if decision['new_support']=='UNRESOLVED' else 'QUARANTINED','sticky':True})
        for decision in result['decisions']:
            if decision['new_support']=='TRUE':
                new_ref=source_ref(value['new_revision'],decision['proposition_id'])
                previous=json.loads(self.flags.get(new_ref,'{}'))
                if previous.get('request_id')==value.get('supersedes_request'):
                    self.flags[new_ref]=canonical({'request_id':request_id,'generation':value['generation'],'status':'CLEAR','sticky':False})
        # Positive permission and consequence reach dispatcher only after this transaction is finalized.
        gl.get_contract_at(self.dispatcher).emit(on='finalized').begin_quarantine(canonical(cert))
        history_append(self.history,{'event':'IMPACT_ASSESSED','request_id':request_id,'generation':value['generation'],'status':result['status'],'certificate_digest':cert['certificate_digest']})

    @gl.public.write
    def expire(self, request_id: str) -> None:
        value=json.loads(self.requests[request_id])
        if now_seconds()<value['deadline']:fail('Deadline has not elapsed')
        if value['status'] in ('TIMEOUT','SUPERSEDED'):return
        if value['status']=='ASSESSED':fail('Assessment already terminal')
        value['status']='TIMEOUT';self.requests[request_id]=canonical(value)
        if not self.certificates.get(request_id,''):
            cert={k:value[k] for k in BINDINGS}
            cert.update(status='UNRESOLVED',decisions=[],reason='DEADLINE_ELAPSED',coverage=False,unresolved=True,superseded_by='',old_revision=value['old_revision'],new_revision=value['new_revision'],propositions=value['propositions'],manifests=value['manifests'])
            cert['certificate_digest']=digest(cert);self.certificates[request_id]=canonical(cert)
            gl.get_contract_at(self.dispatcher).emit(on='finalized').begin_quarantine(canonical(cert))
        history_append(self.history,{'event':'TIMEOUT','request_id':request_id,'generation':value['generation']})

    @gl.public.write
    def replay_certificate(self, request_id: str) -> None:
        cert=json.loads(self.certificates[request_id])
        gl.get_contract_at(self.dispatcher).emit(on='finalized').begin_quarantine(canonical(cert))

    @gl.public.view
    def get_flag(self, revision: str, proposition: str) -> dict:
        return json.loads(self.flags.get(source_ref(revision,proposition),'{"generation":0,"status":"CLEAR","sticky":false}'))

    @gl.public.view
    def get_request(self, request_id: str) -> dict:
        value=json.loads(self.requests[request_id])
        value['attempts']=int(self.attempts.get(request_id,u8(0)))
        value['certificate']=json.loads(self.certificates.get(request_id,'{}'))
        return value

    @gl.public.view
    def get_generation(self) -> int:
        return int(self.generation)

    @gl.public.view
    def get_history(self, offset: int, limit: int) -> dict:
        return history_page(self.history,offset,limit)
