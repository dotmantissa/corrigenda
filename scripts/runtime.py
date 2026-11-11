"""Studio runtime compatibility probe. Reads credentials only from ignored .env."""
import json
import time
from pathlib import Path
from dotenv import load_dotenv
from genlayer_py import create_client,create_account
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionStatus
import os
import argparse
parser=argparse.ArgumentParser(description='Verify finalized messages at a saved runtime probe deployment.')
parser.add_argument('--deployment-receipt',required=True)
options=parser.parse_args()
load_dotenv('.env')
client=create_client(chain=studionet,account=create_account(os.environ['GENLAYER_PRIVATE_KEY']))

def capture(receipt, name):
    consensus=receipt.get('consensus_data',{})
    leaders=consensus.get('leader_receipt',[])
    if isinstance(leaders,dict):leaders=[leaders]
    result={'hash':receipt['hash'],'contract':receipt['to_address'],'status':receipt['status'],'result':receipt.get('result'),'votes':consensus.get('votes',{}),'executions':[{'execution_result':x['execution_result'],'genvm_result':x.get('genvm_result',{})} for x in leaders],'triggered':client.get_triggered_transaction_ids(receipt['hash'])}
    Path('verification/receipts/'+name+'.json').write_text(json.dumps(result,indent=2,default=str))
    assert leaders and leaders[0]['execution_result']=='SUCCESS',result
    return result

p=Path(options.deployment_receipt);existing=json.loads(p.read_text());address=existing['contract']
operation='runtime.finalized.1'
tx=client.write_contract(address=address,function_name='ping',args=[address,operation])
print('Finalized message probe broadcast',tx,flush=True)
Path('verification/receipts/runtime-message-submitted.json').write_text(json.dumps({'transaction':str(tx),'address':address}))
r=client.wait_for_transaction_receipt(tx,status=TransactionStatus.FINALIZED,interval=12000,retries=20)
capture(r,'runtime-message')
for i in range(12):
    result=client.read_contract(address=address,function_name='get',args=[operation])
    if result:
        print('Authenticated finalized message received from',result,flush=True)
        assert result.lower()==address.lower();break
    time.sleep(10)
else:raise RuntimeError('Finalized callback did not execute')
