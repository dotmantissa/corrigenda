"""Produce deterministic single file GenVM deployables from maintained source."""
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
HEADER='# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }\n'
NAMES=['revision_registry','impact_court','dependency_dispatcher','listing_consumer','deployment_consumer','assessment_probe']

def build():
    common=(ROOT/'contracts/src/common.py').read_text()
    for name in NAMES:
        if name.endswith('_consumer'):
            source=(ROOT/'contracts/src/consumer.py').read_text()
            listing=name=='listing_consumer'
            source=source.replace('CONSUMER_CLASS','ListingConsumer' if listing else 'DeploymentConsumer').replace('CONSUMER_KIND','PROVIDER_LISTING' if listing else 'DEPLOYMENT_APPROVAL').replace('CONSUMER_ACTION','authorize_listing' if listing else 'approve_deployment').replace('CONSUMER_RESULT','LISTED' if listing else 'APPROVED')
        else:source=(ROOT/f'contracts/src/{name}.py').read_text()
        (ROOT/f'contracts/{name}.py').write_text(HEADER+common+'\n'+source)

    fixture=(ROOT/'contracts/listing_consumer.py').read_text().replace('class ListingConsumer','class ReviewConsumer').replace('    owner: Address\n    dispatcher:', '    callback_fault: bool\n    owner: Address\n    dispatcher:').replace('        self.owner=Address(owner);','        self.callback_fault=True\n        self.owner=Address(owner);').replace('        require_sender(str(self.dispatcher));ack=record(acknowledgement)',"        require_sender(str(self.dispatcher))\n        if self.callback_fault:fail('Injected acknowledgement delivery failure')\n        ack=record(acknowledgement)")
    fixture+='\n    @gl.public.write\n    def set_callback_fault(self, enabled: bool) -> None:\n        require_sender(str(self.owner))\n        self.callback_fault=enabled\n'
    (ROOT/'tests/fixtures/review_consumer.py').write_text(fixture)

def lint():
    build()
    subprocess.run(['genvm-lint','check',str(ROOT/'tests/fixtures/review_consumer.py'),'--json'],check=True)
    for name in NAMES:
        subprocess.run(['genvm-lint','check',str(ROOT/f'contracts/{name}.py'),'--json'],check=True)

if __name__=='__main__':
    lint() if len(sys.argv)>1 and sys.argv[1]=='lint' else build()
