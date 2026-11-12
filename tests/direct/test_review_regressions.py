import json
import pytest
from tests.conftest import digest
from tests.direct.test_court import court
from tests.direct.test_dispatcher import graph
from tests.direct.test_consumers import consumer


def test_unchanged_assertion_losing_policy_support_quarantines_both_revisions(direct_vm,court,evidence):
    c,m,r,views,calls=court
    c.open_correction(json.dumps(r));evidence('NONMATERIAL','FALSE',True)
    c.assess_impact(r['request_id'])
    context=m.authorization_context(r,r['propositions'][0])
    assert c.get_request(r['request_id'])['certificate']['decisions'][0]['action']=='QUARANTINE'
    assert all(c.get_flag(rev,'security',context)['status']=='QUARANTINED' for rev in ('r0','r1'))


def test_exhausted_public_opening_cannot_install_flags(direct_vm,court,evidence,direct_bob):
    c,m,r,views,calls=court
    for generation in range(1,4):
        request=dict(r,request_id='attempt'+str(generation),generation=generation)
        c.open_correction(json.dumps(request));evidence('NONMATERIAL','TRUE',False);c.assess_impact(request['request_id'])
    context=m.authorization_context(r,r['propositions'][0]);before=c.get_flag('r0','security',context)
    direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Evidence retry limit'):
        c.open_correction(json.dumps(dict(r,request_id='hostile',owner=str(direct_bob),generation=4)))
    assert c.get_flag('r0','security',context)==before and before['status']=='CLEAR'
    assert c.get_generation()==3


def test_deadline_bounded_and_unresolved_recovery_is_public(direct_vm,court,direct_bob):
    c,m,r,views,calls=court
    with direct_vm.expect_revert('deadline'):
        c.open_correction(json.dumps(dict(r,deadline=m.now_seconds()+86401)))
    c.open_correction(json.dumps(r));direct_vm.mock_web('https://example.org/',{'status':503,'body':''});c.assess_impact(r['request_id'])
    direct_vm.sender=direct_bob
    c.open_correction(json.dumps(dict(r,request_id='public.recovery',owner=str(direct_bob),generation=2,supersedes_request=r['request_id'])))
    assert c.get_request(r['request_id'])['status']=='SUPERSEDED'


def test_registration_validates_policy_rules_and_owns_definition_scope(direct_vm,graph,packet):
    c,m,views,calls,flags,node,cert,court_address,consumer_address=graph
    bad=node(0);bad['references'][0]['definition']=dict(packet['propositions'][0],rule_ids=['nonexistent'])
    with direct_vm.expect_revert('Complete policy rule'):c.register_dependency(json.dumps(bad))
    c.register_dependency(json.dumps(node(0)))
    other=node(1);other['policy_id']='other';other['references'][0]['definition']=dict(packet['propositions'][0],statement='Different policy claim')
    views['get_policy']=lambda *args:dict(packet['policy'],policy_id='other')
    c.register_dependency(json.dumps(other))
    context=m.authorization_context(other,other['references'][0]['definition'])
    assert c.get_proposition('r0','security',consumer_address,context)['definition']['statement']=='Different policy claim'
    assert c.get_dependency('d0')['usable'] and c.get_dependency('d1')['usable']


@pytest.mark.parametrize('field,value',[('subject_id','other'),('subject_digest','d'*64),('consequence_digest','e'*64),('statement','Different meaning'),('materiality_question','Different question')])
def test_replacement_cannot_change_authorization_meaning(direct_vm,graph,field,value):
    c,m,views,calls,flags,node,make_cert,court_address,consumer_address=graph
    c.register_dependency(json.dumps(node(0)));direct_vm.sender=m.Address(court_address)
    original=make_cert();c.begin_quarantine(json.dumps(original));c.dispatch_page('correction','security',0,'page')
    replacement=make_cert(request_id='replacement',generation=2)
    if field in ('statement','materiality_question'):replacement['propositions']=[dict(replacement['propositions'][0],**{field:value})]
    else:replacement[field]=value
    replacement['contexts']={'security':m.authorization_context(replacement,replacement['propositions'][0])}
    c.begin_quarantine(json.dumps(replacement))
    notice=c.get_notice(m.tuple_key('notice.v2','correction','security','d0'));flags['r0/security']={'generation':1,'status':'QUARANTINED'}
    ack={'notice_id':notice['operation_id'],'operation_id':'ack','dependency_id':'d0','decision_digest':notice['decision_digest'],'certificate_digest':'c'*64,'generation':1,'route':'REFRESHED','replacement_certificate_id':'replacement'}
    with direct_vm.expect_revert('meaning or consequence'):c.validate_acknowledgement(json.dumps(ack))


def test_dispatcher_replays_lost_ack_callback_and_rejects_late_quarantine(direct_vm,graph):
    c,m,views,calls,flags,node,make_cert,court_address,consumer_address=graph
    c.register_dependency(json.dumps(node(0)));direct_vm.sender=m.Address(court_address)
    c.begin_quarantine(json.dumps(make_cert()));c.dispatch_page('correction','security',0,'page')
    notice=c.get_notice(m.tuple_key('notice.v2','correction','security','d0'));flags['r0/security']={'generation':1,'status':'QUARANTINED'}
    direct_vm.sender=m.Address(consumer_address)
    ack={'notice_id':notice['operation_id'],'operation_id':'ack','dependency_id':'d0','decision_digest':notice['decision_digest'],'certificate_digest':'c'*64,'generation':1,'route':'REFRESHED','replacement_certificate_id':'correction'}
    c.acknowledge_generation(json.dumps(ack));first=calls[-1];calls.clear()
    context=make_cert()['contexts']['security']
    successor_schema=c.get_proposition('r1','security',consumer_address,context)
    assert successor_schema['definition']['old_span']==make_cert()['propositions'][0]['new_span']
    successor_ref=m.source_ref('r1','security',context)
    assert int(c.reverse_counts[successor_ref])==1
    c.acknowledge_generation(json.dumps(ack));assert calls==[first]
    assert c.get_dispatch('correction','security')['total']==1
    late=dict(ack,operation_id='late',route='QUARANTINED')
    with direct_vm.expect_revert('terminal'):c.validate_acknowledgement(json.dumps(late))
    c.acknowledge_generation(json.dumps(late));rejection=json.loads(calls[-1]['calldata']['args'][0])
    assert rejection['delivery_status']=='REJECTED' and c.get_dependency('d0')['usable']
    calls.clear();c.acknowledge_generation(json.dumps(late));assert json.loads(calls[-1]['calldata']['args'][0])==rejection


def test_consumer_replays_pending_ack_even_after_new_generation(direct_vm,consumer):
    c,m,views,calls,config,binding,state,owner,dispatcher,action,status=consumer
    cert=dict(config,generation=1,old_revision='r0',contexts={'security':m.authorization_context(config,config['references'][0]['definition'])},certificate_digest='c'*64,decisions=[{'proposition_id':'security','new_support':'TRUE'}],unresolved=False)
    views['get_certificate']=lambda *args:cert
    notice={'operation_id':'notice','dependency_id':'decision','decision_digest':binding['decision_digest'],'certificate':cert,'proposition_id':'security','action':'REFRESH'}
    direct_vm.sender=m.Address(dispatcher);c.receive_notice(json.dumps(notice));direct_vm.sender=m.Address(owner)
    c.acknowledge_generation('notice',1,'REFRESHED');ack=json.loads(calls[-1]['calldata']['args'][0]);calls.clear()
    c.acknowledge_generation('notice',1,'REFRESHED');assert len(calls)==1
    direct_vm.sender=m.Address(dispatcher);c.receive_notice(json.dumps(dict(notice,operation_id='new',certificate=dict(cert,generation=2))))
    direct_vm.sender=m.Address(owner);calls.clear();c.replay_acknowledgement(ack['operation_id']);assert len(calls)==1
    direct_vm.sender=m.Address(dispatcher);c.receive_acknowledgement(calls[-1]['calldata']['args'][0]);direct_vm.sender=m.Address(owner)
    assert getattr(c,action)('decision','recovered','b'*64)['status']==status


def test_maximum_eight_reference_binding_is_received(direct_vm,consumer):
    c,m,views,calls,config,binding,state,owner,dispatcher,action,status=consumer
    large=dict(config,dependency_id='large',request_id='large')
    refs=[]
    for i in range(8):
        definition=dict(config['references'][0]['definition'],id='p'+str(i),statement='S'*1000,materiality_question='Q'*1000)
        refs.append(dict(config['references'][0],proposition=definition['id'],definition=definition))
    large['references']=refs;c.configure(json.dumps(large))
    expanded=dict(large,ancestors=[dict(ref,context=m.authorization_context(large,ref['definition'])) for ref in refs],decision_digest=digest(large),last_applied_generation=0)
    encoded=m.message_json(expanded);assert len(encoded.encode())>24000
    direct_vm.sender=m.Address(dispatcher);c.receive_binding(encoded)
    assert c.get_decision('large')['binding']['decision_digest']==digest(large)
    with direct_vm.expect_revert('Expanded message'):m.message_json(dict(expanded,extra='x'*65536))


def test_older_assessment_cannot_overwrite_successor_generation(direct_vm,court,evidence,packet):
    c,m,r,views,calls=court;c.open_correction(json.dumps(r))
    successor=dict(packet['manifests'][1],revision_id='r2',request_id='revision2',supersedes='r1')
    packet['manifests'].append(successor)
    newer=dict(r,request_id='newer',generation=2,old_revision='r1',new_revision='r2',source_manifest_digest=digest(packet['manifests'][1:]))
    c.open_correction(json.dumps(newer));context=m.authorization_context(r,r['propositions'][0]);before=c.get_flag('r1','security',context)
    packet['manifests'].pop();evidence();c.assess_impact(r['request_id'])
    assert c.get_flag('r1','security',context)==before and before['generation']==2


def test_colon_identifiers_never_collide(module):
    c,m=module('dependency_dispatcher','0x'+'11'*20,'0x'+'22'*20)
    assert m.tuple_key('cursor.v2','alpha:beta','gamma')!=m.tuple_key('cursor.v2','alpha','beta:gamma')
    assert m.tuple_key('notice.v2','a:b','c','d')!=m.tuple_key('notice.v2','a','b:c','d')
    assert m.tuple_key('acknowledgement.v2','a','b','c')!=m.tuple_key('notice.v2','a','b','c')

def test_authenticated_successor_keep_notice_is_deliverable(direct_vm,consumer):
    c,m,views,calls,config,binding,state,owner,dispatcher,action,status=consumer
    context=m.authorization_context(config,config['references'][0]['definition'])
    cert=dict(config,generation=3,old_revision='r2',contexts={'security':context},certificate_digest='c'*64,unresolved=False)
    notice={'operation_id':'successor.keep','dependency_id':'decision','decision_digest':binding['decision_digest'],'certificate':cert,'proposition_id':'security','action':'KEEP'}
    direct_vm.sender=m.Address(dispatcher);c.receive_notice(json.dumps(notice))
    assert calls[-1]['calldata']['method']=='confirm_delivery'
    assert c.get_decision('decision')['last_applied_generation']==3

def test_repeated_generations_keep_successor_definition_and_index_unique(direct_vm,graph):
    c,m,views,calls,flags,node,make_cert,court_address,consumer_address=graph
    c.register_dependency(json.dumps(node(0)))
    for generation in (1,2):
        direct_vm.sender=m.Address(court_address)
        cert=make_cert(request_id='round'+str(generation),generation=generation)
        c.begin_quarantine(json.dumps(cert));c.dispatch_page(cert['request_id'],'security',0,'page'+str(generation))
        notice=c.get_notice(m.tuple_key('notice.v2',cert['request_id'],'security','d0'))
        flags['r0/security']={'generation':generation,'status':'QUARANTINED'}
        direct_vm.sender=m.Address(consumer_address)
        ack={'notice_id':notice['operation_id'],'operation_id':'ack'+str(generation),'dependency_id':'d0','decision_digest':notice['decision_digest'],'certificate_digest':cert['certificate_digest'],'generation':generation,'route':'REFRESHED','replacement_certificate_id':cert['request_id']}
        c.acknowledge_generation(json.dumps(ack))
    context=cert['contexts']['security']
    assert int(c.reverse_counts[m.source_ref('r1','security',context)])==1
    assert c.get_proposition('r1','security',consumer_address,context)['definition']['old_span']==cert['propositions'][0]['new_span']
    direct_vm.sender=m.Address(court_address)
    following=make_cert(request_id='following',generation=3);following['old_revision']='r1';following['new_revision']='r2'
    c.begin_quarantine(json.dumps(following));c.dispatch_page('following','security',0,'following.page')
    assert c.get_dispatch('following','security')['total']==1
    assert c.get_notice(m.tuple_key('notice.v2','following','security','d0'))['dependency_id']=='d0'
