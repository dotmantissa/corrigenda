import json
import pytest

def setup_registry(module,direct_vm,direct_owner,packet):
    c,m=module('revision_registry')
    a={'authority_id':'issuer','principal':str(m.Address(direct_owner)),'url_prefix':'https://example.org/','channel':'public','public_evidence_url':'https://example.org/principal'}
    c.configure_authority(json.dumps(a));c.register_policy(json.dumps(packet['policy']))
    return c,m

def test_immutable_authority_policy_revision(module,direct_vm,direct_owner,packet):
    c,m=setup_registry(module,direct_vm,direct_owner,packet)
    value=packet['manifests'][0];c.register_revision(json.dumps(value));c.register_revision(json.dumps(value))
    assert c.get_revision('r0')==value
    bad=dict(value,scope='Changed')
    with direct_vm.expect_revert('Conflicting'):c.register_revision(json.dumps(bad))
    assert c.get_history(0,20)['total']==3

def test_only_explicit_principal_can_register(module,direct_vm,direct_owner,direct_bob,packet):
    c,m=setup_registry(module,direct_vm,direct_owner,packet);direct_vm.sender=direct_bob
    with direct_vm.expect_revert('Unauthorized'):c.register_revision(json.dumps(packet['manifests'][0]))
    with direct_vm.expect_revert('Unauthorized'):c.register_policy(json.dumps(packet['policy']))
    with direct_vm.expect_revert('Unauthorized'):c.bind_court(str(direct_bob))

@pytest.mark.parametrize('change',[{'url':'https://evil.example/r0'},{'byte_size':49153},{'byte_digest':'wrong'},{'spans':[]},{'scope':''}])
def test_manifest_limits(module,direct_vm,direct_owner,packet,change):
    c,m=setup_registry(module,direct_vm,direct_owner,packet)
    with direct_vm.expect_revert():c.register_revision(json.dumps(dict(packet['manifests'][0],**change)))

def test_successor_authority_and_pagination(module,direct_vm,direct_owner,packet):
    c,m=setup_registry(module,direct_vm,direct_owner,packet)
    for value in packet['manifests']:c.register_revision(json.dumps(value))
    assert c.get_revision('r1')['supersedes']=='r0'
    assert len(c.get_history(1,2)['items'])==2
    with direct_vm.expect_revert('Integer'):c.get_history(0,21)
