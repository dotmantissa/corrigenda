import json
import pytest
from tests.conftest import digest

@pytest.fixture(params=[('listing_consumer','PROVIDER_LISTING','authorize_listing','LISTED'),('deployment_consumer','DEPLOYMENT_APPROVAL','approve_deployment','APPROVED')])
def consumer(request,module,direct_vm,cross_calls,packet):
 name,kind,action,status=request.param;owner='0x'+'33'*20;dispatcher='0x'+'22'*20
 c,m=module(name,owner,dispatcher);views,calls=cross_calls;direct_vm.sender=m.Address(owner)
 config={'request_id':'configuration','owner':owner,'parties':[owner],'policy_id':'security','policy_revision':1,'subject_id':'provider','subject_digest':'a'*64,'source_manifest_digest':digest([packet['manifests'][0]]),'consumer':str(m.gl.message.contract_address),'consequence_digest':'b'*64,'generation':0,'deadline':9999999999,'dependency_id':'decision','rank':1,'parents':[],'references':[{'revision':'r0','proposition':'security','span':'critical','definition':packet['propositions'][0]}],'kind':kind,'unresolved_route':'QUARANTINED','remediation_route':'ACCEPT_REPLACEMENT'}
 c.configure(json.dumps(config));binding=dict(config,decision_digest=digest(config),ancestors=config['references'],last_applied_generation=0)
 direct_vm.sender=m.Address(dispatcher);c.receive_binding(json.dumps(binding));direct_vm.sender=m.Address(owner)
 state={'usable':True,'last_applied_generation':0,'restrictions':[]}
 views['get_dependency']=lambda *args:state
 return c,m,views,calls,config,binding,state,owner,dispatcher,action,status

def test_consumer_action_queries_ancestor_before_notice(direct_vm,consumer):
 c,m,views,calls,config,binding,state,owner,dispatcher,action,status=consumer
 result=getattr(c,action)('decision','operation','b'*64);assert result['status']==status
 assert getattr(c,action)('decision','operation','b'*64)==result
 state['usable']=False
 with direct_vm.expect_revert('quarantined'):getattr(c,action)('decision','future','b'*64)
 assert c.get_decision('decision')['status']=='SUSPENDED'

def test_consumer_owner_and_consequence_binding(direct_vm,consumer,direct_bob):
 c,m,views,calls,config,binding,state,owner,dispatcher,action,status=consumer
 direct_vm.sender=direct_bob
 with direct_vm.expect_revert('Unauthorized'):getattr(c,action)('decision','operation','b'*64)
 with direct_vm.expect_revert('Unauthorized'):c.receive_binding(json.dumps(binding))
 direct_vm.sender=m.Address(owner)
 with direct_vm.expect_revert('consequence'):getattr(c,action)('decision','operation','c'*64)

def test_duplicate_reordered_notice_and_finalized_ack_gate(direct_vm,consumer):
 c,m,views,calls,config,binding,state,owner,dispatcher,action,status=consumer
 cert=dict(config,generation=2,certificate_digest='c'*64,decisions=[{'proposition_id':'security','new_support':'TRUE'}],unresolved=False)
 views['get_certificate']=lambda *args:cert
 notice={'operation_id':'notice2','dependency_id':'decision','decision_digest':binding['decision_digest'],'certificate':cert,'proposition_id':'security','action':'REFRESH'}
 direct_vm.sender=m.Address(dispatcher);c.receive_notice(json.dumps(notice));c.receive_notice(json.dumps(notice))
 old=dict(notice,operation_id='notice1',certificate=dict(cert,generation=1));c.receive_notice(json.dumps(old))
 assert c.get_decision('decision')['last_applied_generation']==2
 direct_vm.sender=m.Address(owner)
 with direct_vm.expect_revert('Old'):c.acknowledge_generation('notice1',1,'REFRESHED')
 c.acknowledge_generation('notice2',2,'REFRESHED');assert calls[-1]['on']=='finalized'
 with direct_vm.expect_revert('not finalized'):getattr(c,action)('decision','blocked','b'*64)
 ack=calls[-1]['calldata']['args'][0];direct_vm.sender=m.Address(dispatcher);c.receive_acknowledgement(ack);c.receive_acknowledgement(ack)
 direct_vm.sender=m.Address(owner);assert getattr(c,action)('decision','restored','b'*64)['status']==status

def test_consumer_deadline(direct_vm,consumer):
 c,m,views,calls,config,binding,state,owner,dispatcher,action,status=consumer
 direct_vm.warp('2287-01-01T00:00:00Z')
 m.gl.message_raw['datetime']=direct_vm.get_message_raw()['datetime']
 with direct_vm.expect_revert('Deadline'):getattr(c,action)('decision','operation','b'*64)
