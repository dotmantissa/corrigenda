import json

def test_assessment_probe_runs_independent_vector(module,direct_vm,cross_calls,packet,evidence):
 c,m=module('assessment_probe','0x'+'11'*20);views,calls=cross_calls
 views['get_request']=lambda *args:packet
 evidence();c.assess('controlled')
 assert c.get_result('controlled')['decisions'][0]['action']=='QUARANTINE'
 assert direct_vm.run_validator()
 assert calls==[]

def test_runtime_probe_owner_and_finalized_message(module,direct_vm,cross_calls,direct_bob):
 c,m=module('runtime_probe');views,calls=cross_calls
 c.ping('0x'+'11'*20,'operation');assert calls[-1]['on']=='finalized'
 direct_vm.sender=direct_bob
 with direct_vm.expect_revert('Owner required'):c.ping('0x'+'11'*20,'other')
 c.receive('operation');assert c.get('operation')==str(m.Address(direct_bob))
