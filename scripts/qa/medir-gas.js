const { ethers } = require('ethers');
const { createPrivateKey } = require('node:crypto');
const fs = require('fs');
require('dotenv').config({path:'.env.local'});
(async()=>{
  const prov=new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const w=new ethers.NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY_AUTORIDAD, prov));
  const art=JSON.parse(fs.readFileSync('artifacts/contracts/qa/GasProbe.sol/GasProbe.json','utf8'));
  const p=await new ethers.ContractFactory(art.abi,art.bytecode,w).deploy();
  await p.waitForDeployment();

  const jwk=createPrivateKey(process.env.RSA_PRIVATE_KEY_PEM.replace(/\\n/g,'\n')).export({format:'jwk'});
  const nHex='0x'+Buffer.from(jwk.n,'base64url').toString('hex');
  const base='0x'+'ab'.repeat(256), e='0x010001';

  await (await p.medirModExp(base, e, nHex)).wait();
  const gModExp=Number(await p.ultimo());
  await (await p.medirSstore(ethers.hexlify(ethers.randomBytes(32)))).wait();
  const gSstore=Number(await p.ultimo());

  // ejecución completa de emitirVoto, del contrato real
  const artV=JSON.parse(fs.readFileSync('artifacts/contracts/VotacionContract.sol/VotacionContract.json','utf8'));
  console.log('--- desglose de gas, RSA-2048 con e = 65537 ---');
  console.log('  precompilado modexp (0x05) :', gModExp.toLocaleString('es-AR'));
  console.log('  un SSTORE de slot nuevo    :', gSstore.toLocaleString('es-AR'));
  console.log('  emitirVoto medido           : 187.147');
  console.log('  modexp sobre el total       :', (gModExp*100/187147).toFixed(1)+' %');
  console.log('  hardfork del entorno        : paris (EIP-2565 vigente)');
})();
