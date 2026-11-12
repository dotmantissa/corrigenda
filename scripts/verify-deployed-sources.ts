import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chain, contracts } from '../src/lib/server/chain';
const rows = [];
for (const [name, file] of [
  ['registry', 'revision_registry'],
  ['court', 'impact_court'],
  ['dispatcher', 'dependency_dispatcher'],
  ['listing_consumer', 'listing_consumer'],
  ['deployment_consumer', 'deployment_consumer'],
]) {
  const deployed = await chain().getContractCode(contracts[name]);
  const local = await readFile(`contracts/${file}.py`, 'utf8');
  if (deployed !== local)
    throw new Error('Deployed source differs from maintained deployable: ' + name);
  rows.push({
    name,
    address: contracts[name],
    source_digest: createHash('sha256').update(deployed).digest('hex'),
    exact_match: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
await writeFile(
  'verification/source-comparison.json',
  JSON.stringify(
    {
      network: 'studionet',
      chain_id: 61999,
      method:
        'Independent gen_getContractCode RPC retrieval compared byte-for-byte with maintained generated source',
      contracts: rows,
      complete: true,
    },
    null,
    2,
  ) + '\n',
);
console.log('All five live contract sources independently match maintained deployables.');
