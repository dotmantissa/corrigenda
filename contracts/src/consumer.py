class CONSUMER_CLASS(gl.Contract):
    owner: Address
    dispatcher: Address
    configurations: TreeMap[str,str]
    bindings: TreeMap[str,str]
    notices: TreeMap[str,str]
    acknowledgements: TreeMap[str,str]
    actions: TreeMap[str,str]
    history: DynArray[str]
    last_applied: TreeMap[str,u64]
    pending_routes: TreeMap[str,str]
    pending_by_dependency: TreeMap[str,str]
    proposition_generations: TreeMap[str,u64]

    def __init__(self, owner: str, dispatcher: str):
        self.owner=Address(owner);self.dispatcher=Address(dispatcher)

    @gl.public.write
    def configure(self, request: str) -> None:
        require_sender(str(self.owner))
        value=envelope(record(request));require_live(value)
        if Address(value['owner'])!=self.owner or Address(value['consumer'])!=gl.message.contract_address:fail('Consumer configuration binding')
        if value['kind']!='CONSUMER_KIND' or value['unresolved_route']!='QUARANTINED' or value['remediation_route']!='ACCEPT_REPLACEMENT':fail('Explicit consumer policy required')
        identifier(value['dependency_id'])
        fresh=immutable_put(self.configurations,value['dependency_id'],value)
        if not fresh and self.bindings.get(value['dependency_id'],''):return
        gl.get_contract_at(self.dispatcher).emit(on='finalized').register_dependency(canonical(value))
        history_append(self.history,{'event':'CONFIGURATION_PENDING','dependency_id':value['dependency_id']})

    @gl.public.write
    def receive_binding(self, binding: str) -> None:
        require_sender(str(self.dispatcher));node=record(binding,MAX_MESSAGE_BYTES)
        configured=json.loads(self.configurations[node['dependency_id']])
        if node['decision_digest']!=digest(configured) or node['consumer']!=str(gl.message.contract_address):fail('Finalized binding mismatch')
        immutable_put(self.bindings,node['dependency_id'],node)
        history_append(self.history,{'event':'BINDING_FINALIZED','dependency_id':node['dependency_id']})

    @gl.public.write
    def receive_notice(self, notice: str) -> None:
        require_sender(str(self.dispatcher));value=record(notice,MAX_MESSAGE_BYTES)
        binding=json.loads(self.bindings[value['dependency_id']]);cert=value['certificate']
        if binding['decision_digest']!=value['decision_digest'] or cert['policy_id']!=binding['policy_id'] or cert['policy_revision']!=binding['policy_revision']:
            fail('Notice policy or decision mismatch')
        if not any(a['revision']==cert['old_revision'] and a['proposition']==value['proposition_id'] and a['context']==cert['contexts'][value['proposition_id']] for a in binding['ancestors']):
            # Accepted replacement references are verified by the authoritative dispatcher at action time.
            state=gl.get_contract_at(self.dispatcher).view().get_dependency(value['dependency_id'])
            if not any(r['revision']==cert['old_revision'] and r['proposition']==value['proposition_id'] and r['context']==cert['contexts'][value['proposition_id']] for r in state['restrictions']):fail('Notice outside bound authorization')
        fresh=immutable_put(self.notices,value['operation_id'],value)
        gl.get_contract_at(self.dispatcher).emit(on='finalized').confirm_delivery(value['operation_id'])
        if not fresh:return
        generation=cert['generation']
        previous=int(self.last_applied.get(value['dependency_id'],u64(0)))
        self.last_applied[value['dependency_id']]=u64(max(previous,generation))
        key=tuple_key('consumer-generation.v2',value['dependency_id'],source_ref(cert['old_revision'],value['proposition_id'],cert['contexts'][value['proposition_id']]))
        self.proposition_generations[key]=u64(max(int(self.proposition_generations.get(key,u64(0))),generation))
        history_append(self.history,{'event':'NOTICE_RECEIVED','dependency_id':value['dependency_id'],'operation_id':value['operation_id'],'generation':generation,'action':value['action']})

    @gl.public.write
    def acknowledge_generation(self, operation_id: str, generation: int, route: str, replacement_certificate_id: str = "") -> None:
        require_sender(str(self.owner));notice=json.loads(self.notices[operation_id]);cert=notice['certificate']
        key=tuple_key('consumer-generation.v2',notice['dependency_id'],source_ref(cert['old_revision'],notice['proposition_id'],cert['contexts'][notice['proposition_id']]))
        if generation!=cert['generation'] or generation<int(self.proposition_generations.get(key,u64(0))):fail('Old acknowledgement')
        if route not in ('REFRESHED','QUARANTINED'):fail('Unsupported remediation')
        if not replacement_certificate_id:replacement_certificate_id=cert['request_id']
        replacement=gl.get_contract_at(self.dispatcher).view().get_certificate(replacement_certificate_id)
        if route=='REFRESHED':
            decision=next((d for d in replacement['decisions'] if d['proposition_id']==notice['proposition_id']),None)
            if replacement['unresolved'] or decision is None or decision['new_support']!='TRUE':fail('Replacement evidence unsupported')
        acknowledgement_id=tuple_key('acknowledgement.v2',operation_id,route,replacement_certificate_id)
        ack={'operation_id':acknowledgement_id,'notice_id':operation_id,'replacement_certificate_id':replacement_certificate_id,'generation':generation,'route':route,'dependency_id':notice['dependency_id'],'decision_digest':notice['decision_digest'],'certificate_digest':cert['certificate_digest'],'owner':str(self.owner)}
        if self.pending_routes.get(acknowledgement_id,''):
            immutable_put(self.pending_routes,acknowledgement_id,ack)
            gl.get_contract_at(self.dispatcher).emit(on='finalized').acknowledge_generation(canonical(ack))
            return
        gl.get_contract_at(self.dispatcher).view().validate_acknowledgement(canonical(ack))
        immutable_put(self.pending_routes,acknowledgement_id,ack)
        pending_ids=json.loads(self.pending_by_dependency.get(notice['dependency_id'],'[]'))
        if len(pending_ids)>=64:fail('Remediation history limit; explicit rebinding required')
        pending_ids.append(acknowledgement_id);self.pending_by_dependency[notice['dependency_id']]=canonical(pending_ids)
        gl.get_contract_at(self.dispatcher).emit(on='finalized').acknowledge_generation(canonical(ack))

    @gl.public.write
    def replay_acknowledgement(self, operation_id: str) -> None:
        require_sender(str(self.owner))
        pending=self.pending_routes.get(operation_id,'')
        if not pending:fail('Unknown acknowledgement')
        gl.get_contract_at(self.dispatcher).emit(on='finalized').acknowledge_generation(pending)

    @gl.public.write
    def receive_acknowledgement(self, acknowledgement: str) -> None:
        require_sender(str(self.dispatcher));ack=record(acknowledgement)
        pending=json.loads(self.pending_routes[ack['operation_id']])
        if pending!={k:v for k,v in ack.items() if k!='delivery_status'}:fail('Acknowledgement operation mismatch')
        if not immutable_put(self.acknowledgements,ack['operation_id'],ack):return
        history_append(self.history,dict(ack,event='REMEDIATION_FINALIZED'))

    @gl.public.write
    def CONSUMER_ACTION(self, dependency_id: str, operation_id: str, consequence_digest: str) -> dict:
        require_sender(str(self.owner));identifier(operation_id);hex_digest(consequence_digest)
        binding=json.loads(self.bindings[dependency_id]);require_live(binding)
        if consequence_digest!=binding['consequence_digest']:fail('Intended consequence changed')
        request={'dependency_id':dependency_id,'operation_id':operation_id,'consequence_digest':consequence_digest}
        existing=self.actions.get(operation_id,'')
        if existing:
            previous=json.loads(existing)
            if previous['request']!=request:fail('Conflicting request ID reuse')
            return previous
        state=gl.get_contract_at(self.dispatcher).view().get_dependency(dependency_id)
        if not state['usable']:fail('Evidence quarantined or unresolved')
        # A refresh only grants permission after the dispatcher has finalized its authenticated acknowledgement callback.
        for pending_id in json.loads(self.pending_by_dependency.get(dependency_id,'[]')):
            if not self.acknowledgements.get(pending_id,''):fail('Remediation acknowledgement not finalized')
        result={'request':request,'status':'CONSUMER_RESULT','generation':state['last_applied_generation'],'subject_id':binding['subject_id'],'subject_digest':binding['subject_digest'],'policy_id':binding['policy_id'],'policy_revision':binding['policy_revision'],'decision_digest':binding['decision_digest']}
        self.actions[operation_id]=canonical(result)
        history_append(self.history,dict(result,event='ACTION_AUTHORIZED'))
        return result

    @gl.public.view
    def get_decision(self, dependency_id: str) -> dict:
        binding=json.loads(self.bindings[dependency_id]);state=gl.get_contract_at(self.dispatcher).view().get_dependency(dependency_id)
        return {'dependency_id':dependency_id,'kind':'CONSUMER_KIND','status':'CONSUMER_RESULT' if state['usable'] else 'SUSPENDED','usable':state['usable'],'binding':binding,'restrictions':state['restrictions'],'last_applied_generation':int(self.last_applied.get(dependency_id,u64(0)))}

    @gl.public.view
    def get_action(self, operation_id: str) -> dict:
        return json.loads(self.actions.get(operation_id,'{}'))

    @gl.public.view
    def get_history(self, offset: int, limit: int) -> dict:
        return history_page(self.history,offset,limit)
