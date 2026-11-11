class RevisionRegistry(gl.Contract):
    owner: Address
    court: Address
    authorities: TreeMap[str,str]
    policies: TreeMap[str,str]
    revisions: TreeMap[str,str]
    operations: TreeMap[str,str]
    history: DynArray[str]
    schema_version: u32

    def __init__(self):
        self.owner = gl.message.sender_address
        self.schema_version = u32(SCHEMA)

    @gl.public.write
    def bind_court(self, address: str) -> None:
        require_sender(str(self.owner))
        if self.court != Address('0x'+'00'*20):
            if self.court != Address(address): fail('Court already bound')
            return
        self.court = Address(address)

    @gl.public.write
    def configure_authority(self, request: str) -> None:
        require_sender(str(self.owner))
        value = record(request)
        identifier(value['authority_id'])
        Address(value['principal'])
        prefix = value['url_prefix']
        if not isinstance(prefix,str) or not prefix.startswith('https://') or not prefix.endswith('/') or len(prefix)>512:
            fail('Explicit HTTPS authority prefix required')
        if not value.get('public_evidence_url','').startswith('https://'):
            fail('Disclosed principal evidence required')
        identifier(value['channel'])
        if immutable_put(self.authorities,value['authority_id'],value):
            history_append(self.history,dict(value,event='AUTHORITY_CONFIGURED'))

    @gl.public.write
    def register_policy(self, request: str) -> None:
        require_sender(str(self.owner))
        value = record(request)
        identifier(value['policy_id'])
        bounded_int(value['revision'],1,2**32-1)
        if not isinstance(value.get('rules'),list) or not 1 <= len(value['rules']) <= 8:
            fail('Policy rule limit')
        ids=set()
        for rule in value['rules']:
            identifier(rule['id'])
            if rule['id'] in ids or not isinstance(rule['text'],str) or not 1 <= len(rule['text']) <= 1000:
                fail('Invalid rule')
            ids.add(rule['id'])
        key=value['policy_id']+':'+str(value['revision'])
        if immutable_put(self.policies,key,value):
            history_append(self.history,dict(value,event='POLICY_REGISTERED'))

    @gl.public.write
    def register_revision(self, request: str) -> None:
        value = record(request)
        identifier(value['request_id']);identifier(value['revision_id']);identifier(value['source_id'])
        authority=json.loads(self.authorities[value['authority_id']])
        require_sender(authority['principal'])
        if value['channel'] != authority['channel'] or not value['url'].startswith(authority['url_prefix']) or len(value['url'])>1024:
            fail('Source outside signed authority scope')
        bounded_int(value['byte_size'],1,MAX_RECORD_BYTES)
        hex_digest(value['byte_digest'])
        if not isinstance(value['scope'],str) or not 1 <= len(value['scope'])<=1000:
            fail('Scope limit')
        parse_spans(value['spans'],value['byte_size'])
        if value.get('supersedes'):
            old=json.loads(self.revisions[value['supersedes']])
            if old['source_id']!=value['source_id'] or old['authority_id']!=value['authority_id']:
                fail('Revision authority mismatch')
        if self.operations.get(value['request_id'],''):
            immutable_put(self.operations,value['request_id'],value)
            return
        existing=self.revisions.get(value['revision_id'],'')
        if existing and existing!=canonical(value):fail('Immutable revision')
        immutable_put(self.operations,value['request_id'],value)
        self.revisions[value['revision_id']]=canonical(value)
        history_append(self.history,dict(value,event='REVISION_REGISTERED'))

    @gl.public.view
    def get_revision(self, revision_id: str) -> dict:
        return json.loads(self.revisions[revision_id])

    @gl.public.view
    def get_policy(self, policy_id: str, revision: int) -> dict:
        return json.loads(self.policies[policy_id+':'+str(revision)])

    @gl.public.view
    def get_history(self, offset: int, limit: int) -> dict:
        return history_page(self.history,offset,limit)
