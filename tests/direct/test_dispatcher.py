import json
import pytest
from tests.conftest import digest

@pytest.fixture
def graph(module,direct_vm,cross_calls,packet):
    court='0x'+'11'*20;registry='0x'+'22'*20;consumer='0x'+'33'*20
    c,m=module('dependency_dispatcher',court,registry);views,calls=cross_calls
    views['get_revision']=lambda revision:next(v for v in packet['manifests'] if v['revision_id']==revision)
    flags={};views['get_flag']=lambda revision,prop:flags.get(revision+'/'+prop,{'generation':0,'status':'CLEAR','sticky':False})
    direct_vm.sender=m.Address(consumer)
    def node(i,parents=None):
        return {'request_id':'node'+str(i),'owner':consumer,'parties':[consumer],'policy_id':'security','policy_revision':1,'subject_id':'subject'+str(i),'subject_digest':'a'*64,'source_manifest_digest':digest([packet['manifests'][0]]),'consumer':consumer,'consequence_digest':'b'*64,'generation':0,'deadline':9999999999,'dependency_id':'d'+str(i),'rank':i+1,'parents':parents or [],'references':[{'revision':'r0','proposition':'security','span':'critical','definition':packet['propositions'][0]}]}
    def certificate(generation=1,request_id='correction',new_support='TRUE'):
        value={k:node(0)[k] for k in ('request_id','owner','parties','policy_id','policy_revision','subject_id','subject_digest','source_manifest_digest','consumer','consequence_digest','generation','deadline')}
        value.update(request_id=request_id,generation=generation,status='ASSESSED',unresolved=False,coverage=True,decisions=[{'proposition_id':'security','impact':'QUALIFICATION','old_support':'TRUE','new_support':new_support,'material':True,'action':'REFRESH'}],propositions=packet['propositions'],old_revision='r0',new_revision='r1',certificate_digest='c'*64)
        return value
    return c,m,views,calls,flags,node,certificate,court,consumer

def test_deep_ranked_chain_multi_page_and_replay(direct_vm,graph):
    c,m,views,calls,flags,node,cert,court,consumer=graph
    for i in range(45):c.register_dependency(json.dumps(node(i,['d'+str(i-1)] if i else [])))
    assert len(calls)==45 and all(call['on']=='finalized' for call in calls)
    assert c.get_dependency('d44')['usable']
    flags['r0/security']={'generation':1,'status':'UNRESOLVED'}
    assert not c.get_dependency('d44')['usable'] # notice has not been emitted
    direct_vm.sender=m.Address(court);c.begin_quarantine(json.dumps(cert()));c.begin_quarantine(json.dumps(cert()))
    first=c.dispatch_page('correction','security',0,'page.0');assert first['cursor']==20 and first['status']=='PENDING'
    assert c.dispatch_page('correction','security',0,'page.0')['status']=='REPLAYED'
    assert c.dispatch_page('correction','security',20,'page.1')['cursor']==40
    assert c.dispatch_page('correction','security',40,'page.2')['status']=='COMPLETE'
    assert c.get_dispatch('correction','security')['total']==45
    assert len(calls)==90
    assert not c.get_dependency('d44')['usable']

def test_backward_edge_and_conflicting_registration(direct_vm,graph):
    c,m,views,calls,flags,node,cert,court,consumer=graph
    c.register_dependency(json.dumps(node(5)))
    with direct_vm.expect_revert('Backward'):c.register_dependency(json.dumps(node(1,['d5'])))
    with direct_vm.expect_revert('Conflicting'):c.register_dependency(json.dumps(dict(node(5),subject_id='other')))

def test_old_acknowledgement_cannot_clear_new_generation(direct_vm,graph):
    c,m,views,calls,flags,node,cert,court,consumer=graph
    c.register_dependency(json.dumps(node(0)));direct_vm.sender=m.Address(court);c.begin_quarantine(json.dumps(cert()));c.dispatch_page('correction','security',0,'page0')
    notice=c.get_notice('correction:security:d0')
    flags['r0/security']={'generation':2,'status':'QUARANTINED'}
    direct_vm.sender=m.Address(consumer)
    ack={'notice_id':notice['operation_id'],'operation_id':'ack1','dependency_id':'d0','decision_digest':notice['decision_digest'],'certificate_digest':'c'*64,'generation':1,'route':'REFRESHED','replacement_certificate_id':'correction'}
    with direct_vm.expect_revert('Superseded'):c.validate_acknowledgement(json.dumps(ack))
    c.acknowledge_generation(json.dumps(ack))
    assert json.loads(calls[-1]['calldata']['args'][0])['delivery_status']=='REJECTED'
    assert not c.get_dependency('d0')['usable']

def test_finalized_refresh_duplicate_and_quarantine_recovery(direct_vm,graph):
    c,m,views,calls,flags,node,cert,court,consumer=graph
    c.register_dependency(json.dumps(node(0)));direct_vm.sender=m.Address(court);c.begin_quarantine(json.dumps(cert()));c.dispatch_page('correction','security',0,'page0')
    notice=c.get_notice('correction:security:d0');flags['r0/security']={'generation':1,'status':'QUARANTINED'}
    direct_vm.sender=m.Address(consumer)
    ack={'notice_id':notice['operation_id'],'operation_id':'ack.quarantine','dependency_id':'d0','decision_digest':notice['decision_digest'],'certificate_digest':'c'*64,'generation':1,'route':'QUARANTINED','replacement_certificate_id':'correction'}
    c.acknowledge_generation(json.dumps(ack));assert not c.get_dependency('d0')['usable']
    ack.update(operation_id='ack.refresh',route='REFRESHED');c.acknowledge_generation(json.dumps(ack));c.acknowledge_generation(json.dumps(ack))
    assert c.get_dependency('d0')['usable']
    flags['r1/security']={'generation':2,'status':'UNRESOLVED'}
    assert not c.get_dependency('d0')['usable']

def test_unauthorized_finality_callbacks(direct_vm,graph):
    c,m,views,calls,flags,node,cert,court,consumer=graph
    with direct_vm.expect_revert('Unauthorized'):c.begin_quarantine(json.dumps(cert()))

def test_unrelated_proposition_is_usable(direct_vm,graph,packet):
    c,m,views,calls,flags,node,cert,court,consumer=graph
    value=node(0);value['references'][0]['proposition']='unrelated';value['references'][0]['definition']=dict(packet['propositions'][0],id='unrelated')
    c.register_dependency(json.dumps(value));flags['r0/security']={'generation':1,'status':'UNRESOLVED'}
    assert c.get_dependency('d0')['usable']
