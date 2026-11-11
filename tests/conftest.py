import hashlib
import json
import pytest

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def h(value):return hashlib.sha256(value.encode()).hexdigest()

@pytest.fixture
def module(direct_deploy):
    def load(name,*args):
        contract=direct_deploy('contracts/'+name+'.py',*args,sdk_version='v0.2.12')
        import sys
        return contract,sys.modules[type(contract._instance).__module__]
    return load

@pytest.fixture
def packet():
    old='The provider passed all security controls. All critical findings are resolved.\nException: approval requires no open critical issue.\n'
    new='The provider security approval is withdrawn. One critical finding remains open.\nException: approval requires no open critical issue.\n'
    manifests=[]
    for idx,text in enumerate([old,new]):
        manifests.append({'request_id':'revision'+str(idx),'revision_id':'r'+str(idx),'source_id':'provider','authority_id':'issuer','channel':'public','url':'https://example.org/r'+str(idx),'byte_size':len(text.encode()),'byte_digest':h(text),'scope':'Complete public security notice','spans':[{'id':'critical','start':0,'end':len(text.encode()),'digest':h(text)}],'supersedes':'' if idx==0 else 'r0'})
    p={'id':'security','statement':'The provider has no unresolved critical finding','materiality_question':'Does the evidence support authorizing the provider under the no open critical issue policy?','old_span':'critical','new_span':'critical','rule_ids':['critical','exception']}
    return {'manifests':manifests,'propositions':[p],'policy':{'policy_id':'security','revision':1,'rules':[{'id':'critical','text':'No unresolved critical findings'},{'id':'exception','text':'Approval requires no open critical issue'}]},'texts':[old,new]}

@pytest.fixture
def evidence(direct_vm,packet):
    def install(impact='RETRACTION',new_support='FALSE',material=True,old_support='TRUE',extra=None):
        direct_vm.clear_mocks()
        for m,text in zip(packet['manifests'],packet['texts']):direct_vm.mock_web(m['url'],{'status':200,'body':text})
        decision={'proposition_id':'security','impact':impact,'old_support':old_support,'new_support':new_support,'material':material,'rule_ids':['critical','exception'],'witness_ids':sorted([m['byte_digest']+':critical' for m in packet['manifests']])}
        if extra:decision.update(extra)
        direct_vm.mock_llm('CORRIGENDA_INDEPENDENT_ASSESSMENT',json.dumps({'decisions':[decision]}))
        return decision
    return install

@pytest.fixture
def cross_calls(direct_vm):
    calls=[];views={}
    def hook(vm,request):
        from genlayer.py import calldata
        from genlayer.py.public_abi import ResultCode
        if 'PostMessage' in request:
            calls.append(request['PostMessage']);return {'ok':None}
        if 'CallContract' in request:
            call=request['CallContract'];method=call['calldata']['method'];args=call['calldata'].get('args',[])
            answer=views[method](*args)
            return bytes([ResultCode.RETURN])+calldata.encode(answer)
        return None
    direct_vm._gl_call_hook=hook
    return views,calls
