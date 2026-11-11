import json
import pytest
from tests.conftest import digest

@pytest.fixture
def court(module,direct_vm,cross_calls,packet):
 c,m=module('impact_court','0x'+'11'*20);views,calls=cross_calls
 c.bind_dispatcher('0x'+'22'*20)
 views['get_revision']=lambda r:next(x for x in packet['manifests'] if x['revision_id']==r)
 views['get_policy']=lambda *args:packet['policy']
 views['get_proposition']=lambda *args:{'definition':packet['propositions'][0],'policy_id':'security','policy_revision':1}
 request={'request_id':'correction','owner':str(c.owner),'parties':[str(c.owner)],'policy_id':'security','policy_revision':1,'subject_id':'provider','subject_digest':'a'*64,'source_manifest_digest':digest(packet['manifests']),'consumer':'0x'+'33'*20,'consequence_digest':'b'*64,'generation':1,'deadline':9999999999,'old_revision':'r0','new_revision':'r1','propositions':packet['propositions']}
 return c,m,request,views,calls

def test_lock_assess_flags_and_finalized_emit(direct_vm,court,evidence):
 c,m,r,views,calls=court;c.open_correction(json.dumps(r));c.open_correction(json.dumps(r))
 assert c.get_flag('r0','security')['status']=='UNRESOLVED'
 evidence();c.assess_impact('correction');assert c.get_request('correction')['status']=='ASSESSED'
 assert c.get_flag('r0','security')['status']=='QUARANTINED'
 assert c.get_flag('r1','security')['status']=='QUARANTINED'
 assert calls[-1]['on']=='finalized'
 assert direct_vm.run_validator()
 c.assess_impact('correction');assert len(calls)==1

def test_locked_materiality_cannot_be_weakened(direct_vm,court):
 c,m,r,views,calls=court;r['propositions']=[dict(r['propositions'][0],materiality_question='Does a spelling change matter?')]
 with direct_vm.expect_revert('Locked proposition'):c.open_correction(json.dumps(r))

def test_nonmaterial_releases_only_current_clear_flag(direct_vm,court,evidence):
 c,m,r,views,calls=court;c.open_correction(json.dumps(r));evidence('NONMATERIAL','TRUE',False);c.assess_impact('correction')
 assert c.get_flag('r0','security')['status']=='CLEAR'

def test_unresolved_successor_preserves_certificates_and_bounds_retries(direct_vm,court,evidence):
 c,m,r,views,calls=court;c.open_correction(json.dumps(r));direct_vm.mock_web('https://example.org/',{'status':503,'body':''})
 c.assess_impact('correction');original=c.get_request('correction')['certificate'];c.assess_impact('correction')
 assert c.get_request('correction')['attempts']==1
 for i in range(2,4):
  r=dict(r,request_id='recovery'+str(i),generation=i,supersedes_request=r['request_id'])
  c.open_correction(json.dumps(r));c.assess_impact(r['request_id'])
 assert c.get_request('correction')['certificate']==original
 assert c.get_request('correction')['status']=='SUPERSEDED'
 with direct_vm.expect_revert('Evidence retry limit'):c.open_correction(json.dumps(dict(r,request_id='recovery4',generation=4,supersedes_request=r['request_id'])))
 assert c.get_flag('r0','security')['status']=='UNRESOLVED'

def test_timeout_recovery_and_locked_binding(direct_vm,court,evidence):
 c,m,r,views,calls=court;c.open_correction(json.dumps(r))
 direct_vm.warp('2287-01-01T00:00:00Z');m.gl.message_raw['datetime']=direct_vm.get_message_raw()['datetime']
 with direct_vm.expect_revert('Deadline'):c.assess_impact('correction')
 c.expire('correction');assert c.get_request('correction')['status']=='TIMEOUT'
 assert json.loads(calls[-1]['calldata']['args'][0])['unresolved']
 recovery=dict(r,request_id='recovered',generation=2,deadline=19999999999,supersedes_request='correction')
 with direct_vm.expect_revert('locked'):c.open_correction(json.dumps(dict(recovery,subject_id='other')))
 c.open_correction(json.dumps(recovery));evidence('NONMATERIAL','TRUE',False);c.assess_impact('recovered')
 assert c.get_request('recovered')['status']=='ASSESSED'
 assert c.get_request('correction')['superseded_by']=='recovered'

def test_owner_generation_envelope_and_conflicting_reuse(direct_vm,court,direct_bob):
 c,m,r,views,calls=court
 direct_vm.sender=direct_bob
 with direct_vm.expect_revert('Unauthorized'):c.open_correction(json.dumps(r))
 direct_vm.sender=c.owner;c.open_correction(json.dumps(r))
 with direct_vm.expect_revert('Conflicting'):c.open_correction(json.dumps(dict(r,subject_id='other')))
