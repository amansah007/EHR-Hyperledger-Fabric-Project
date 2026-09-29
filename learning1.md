# Hyperledger Fabric — EHR Project Learning Notes

All commands are run from `fabric-samples/test-network` unless noted otherwise.

---

## 1. Setup and deployment

### Syntax check (from `fabric-samples/`)

```bash
node --check asset-transfer-basic/chaincode-javascript/lib/ehrChainCode.js
```

`node --check` only catches syntax errors. Undefined variables (typos like `result` vs `results`) are only caught by eslint or at runtime.

### Start the network

```bash
./network.sh up createChannel -ca -s couchdb
```

- `-ca` starts a Fabric CA per org (needed for register/enroll and the `role` / `uuid` attributes).
- `-s couchdb` uses CouchDB as the state database (rich queries + web UI on port 5984).

### Deploy the chaincode

```bash
./network.sh deployCC -ccn ehrChainCode -ccp ../asset-transfer-basic/chaincode-javascript/ -ccl javascript
```

### Redeploy after changing the chaincode

Check the current sequence first, then use **sequence + 1** and a new version:

```bash
source ./scripts/envVar.sh && setGlobals 1
peer lifecycle chaincode querycommitted --channelID mychannel --name ehrChainCode

./network.sh deployCC -ccn ehrChainCode -ccp ../asset-transfer-basic/chaincode-javascript/ -ccl javascript -ccv 1.2 -ccs 3
```

Reusing a sequence number that is already committed fails with `ENDORSEMENT_POLICY_FAILURE`.

---

## 2. Identities with Fabric CA

**Register** = an admin creates an account on the CA (name, type, attributes, secret). No key or certificate is created.
**Enroll** = the user logs in with that secret and receives a private key + signed certificate.

Order: the CA's bootstrap admin (`-b admin:adminpw` in `compose/compose-ca.yaml`) enrolls first, then registers everyone else, then each user enrolls.

### Enroll the CA admin (Org1)

```bash
export PATH=${PWD}/../bin:$PATH
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client enroll \
  -u https://admin:adminpw@localhost:7054 \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem

find ~/fabric-lab/org1-admin -type f
openssl x509 -in ~/fabric-lab/org1-admin/msp/signcerts/cert.pem -noout -subject -issuer -dates
```

Output:

```
subject=C = US, ST = North Carolina, O = Hyperledger, OU = client, CN = admin
issuer=C = US, ST = North Carolina, O = Hyperledger, OU = Fabric, CN = fabric-ca-server
notBefore=Sep 29 06:04:00 2026 GMT
notAfter=Sep 29 06:29:00 2027 GMT
```

- `CN` = identity name, `OU` = identity type (client / peer / admin / orderer).
- The CA bootstrap admin is `OU = client`: it can register users, but the network does not treat it as an Org1 admin.
- Files created: `msp/keystore/*_sk` (private key), `msp/signcerts/cert.pem` (certificate), `msp/cacerts/` (the CA that signed it).

### Register a user (done by the admin)

```bash
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client register \
  --caname ca-org1 \
  --id.name patient01 \
  --id.secret patient01pw \
  --id.type client \
  --id.attrs 'role=patient:ecert,uuid=patient01:ecert' \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
```

- `:ecert` puts the attribute into the certificate automatically at enroll time.
- Check the stored record: `fabric-ca-client identity list --id patient01 --caname ca-org1 --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem`

### Enroll the user (done by the user)

```bash
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/patient01

fabric-ca-client enroll \
  -u https://patient01:patient01pw@localhost:7054 \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
```

### Registered actors

![alt text](image.png)

| Identity | Org | CA | `role` |
|---|---|---|---|
| hospitalA | Org1 | ca-org1 (7054) | hospital |
| doctorA | Org1 | ca-org1 | doctor |
| patient01, patient02 | Org1 | ca-org1 | patient |
| insuranceCoA | Org2 | ca-org2 (8054) | insuranceAdmin |
| agentA | Org2 | ca-org2 | agent |

Org2 identities are registered by Org2's CA admin (`~/fabric-lab/org2-admin`, port 8054, `--caname ca-org2`, `fabric-ca/org2/ca-cert.pem`).

### Copy the NodeOU config into each MSP

```bash
for ID in patient01 hospitalA doctorA patient02; do
  cp organizations/peerOrganizations/org1.example.com/msp/config.yaml ~/fabric-lab/$ID/msp/
done
for ID in insuranceCoA agentA; do
  cp organizations/peerOrganizations/org2.example.com/msp/config.yaml ~/fabric-lab/$ID/msp/
done
```

`config.yaml` tells the MSP how to read the `OU` field (client / peer / admin / orderer).

---

## 3. Calling the chaincode with the peer CLI

### Set identity and peer

Run the exports **from `test-network`** (`${PWD}` is resolved at export time):

```bash
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH=~/fabric-lab/hospitalA/msp   # change this line to switch identity
```

### Query (read-only, one peer, nothing written)

```bash
peer chaincode query -C mychannel -n ehrChainCode -c '{"function":"getAllPatient","Args":[]}'
```

- `-C` channel, `-n` chaincode name, `-c` the call (function + list of string args).
- JSON arguments go inside `Args` as one escaped string: `'{"function":"getPatientById","Args":["{\"patientId\":\"patient01\"}"]}'`

![alt text](image-1.png)

### Invoke (write: endorse → order → validate → commit)

```bash
peer chaincode invoke \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile ${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
  -C mychannel -n ehrChainCode \
  --peerAddresses localhost:7051 --tlsRootCertFiles ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  --peerAddresses localhost:9051 --tlsRootCertFiles ${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt \
  -c '{"function":"onboardPatient","Args":["{\"patientId\":\"patient01\",\"name\":\"Test Patient\",\"dob\":\"1998-01-01\",\"city\":\"Kanpur\"}"]}' \
  --waitForEvent
```

- `-o` orderer (needed for ordering).
- Two `--peerAddresses`: the default endorsement policy is a majority of orgs, so both Org1 and Org2 peers must endorse.
- `--waitForEvent` waits until the transaction is committed (`committed with status (VALID)`).

To avoid retyping, save the repeated flags once:

```bash
INVOKE_FLAGS="-o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile ${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
  -C mychannel -n ehrChainCode \
  --peerAddresses localhost:7051 --tlsRootCertFiles ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  --peerAddresses localhost:9051 --tlsRootCertFiles ${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt \
  --waitForEvent"
```

### Patient grants access, then the doctor reads

![alt text](image-2.png)

```bash
# as the patient
export CORE_PEER_MSPCONFIGPATH=~/fabric-lab/patient01/msp
peer chaincode invoke $INVOKE_FLAGS \
  -c '{"function":"grantAccess","Args":["{\"patientId\":\"patient01\",\"doctorIdToGrant\":\"doctorA\"}"]}'

# as the doctor
export CORE_PEER_MSPCONFIGPATH=~/fabric-lab/doctorA/msp
peer chaincode query -C mychannel -n ehrChainCode \
  -c '{"function":"getPatientById","Args":["{\"patientId\":\"patient01\"}"]}'
```

![alt text](image-3.png)

---

## 4. Certificate revocation

### Step 1 — Revoke at the CA

```bash
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client revoke \
  -e doctorA \
  -r keycompromise \
  --gencrl \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
```

- Marks doctorA's certificate (by serial number) and the identity as revoked in the CA's database.
- `--gencrl` writes the revocation list to `~/fabric-lab/org1-admin/msp/crls/crl.pem`.

### Step 2 — Test what changed

Re-enroll is blocked (the CA checks its own database):

```bash
FABRIC_CA_CLIENT_HOME=/tmp/test-doctorA fabric-ca-client enroll \
  -u https://doctorA:doctorApw@localhost:7054 --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
# Error Code: 20 - Authentication failure
```

But the existing certificate still works on the network — still able to get the patient details:

![alt text](image-4.png)

**Reason:** there are two places that store *who is trusted*:

| | CA database | Channel config (Org1MSP) |
|---|---|---|
| Used by | The CA, only at enroll time | Every peer, on every request |
| Knew about the revocation | Yes | No — `revocation_list` was empty |

Peers never contact the CA. The CRL has to be added to Org1MSP in the channel configuration.

### Step 3 — Fetch the channel config (as Org1's admin)

```bash
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export ORDERER_CA=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem

mkdir -p ~/fabric-lab/crl-update && cd ~/fabric-lab/crl-update

peer channel fetch config config_block.pb \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  -c mychannel \
  --tls --cafile $ORDERER_CA
```

- Uses `Admin@org1` because only Org1's admin may change Org1's section of the channel config.
- The client fetches the newest block, reads its pointer to the last config block, then fetches that block.

### Step 4 — Decode it to readable JSON

```bash
configtxlator proto_decode --input config_block.pb --type common.Block --output config_block.json

jq '.data.data[0].payload.data.config' config_block.json > config.json

jq '.channel_group.groups.Application.groups.Org1MSP.values.MSP.value.config.revocation_list' config.json
# []  ← empty, which is why doctorA still worked
```

### Step 5 — Add the CRL to a modified copy

```bash
CRL=$(base64 -w 0 ~/fabric-lab/org1-admin/msp/crls/crl.pem)

jq --arg crl "$CRL" \
  '.channel_group.groups.Application.groups.Org1MSP.values.MSP.value.config.revocation_list = [$crl]' \
  config.json > modified_config.json

jq '.channel_group.groups.Application.groups.Org1MSP.values.MSP.value.config.revocation_list' modified_config.json
```

- The channel config stores certificates and CRLs as base64.
- Peers only accept the CRL because it is signed by Org1's CA (in `root_certs`).

### Step 6 — Compute the update (only the difference)

```bash
configtxlator proto_encode --input config.json --type common.Config --output config.pb
configtxlator proto_encode --input modified_config.json --type common.Config --output modified_config.pb

configtxlator compute_update --channel_id mychannel \
  --original config.pb --updated modified_config.pb --output config_update.pb

configtxlator proto_decode --input config_update.pb --type common.ConfigUpdate --output config_update.json
jq '.write_set.groups.Application.groups | keys' config_update.json
# ["Org1MSP"]  ← only Org1 is changed
```

- `read_set` = versions the update expects; `write_set` = new values. A version mismatch means rejection (same idea as MVCC).

![alt text](image-5.png)

### Step 7 — Sign and submit

```bash
# who may approve a change to Org1MSP?
jq '.channel_group.groups.Application.groups.Org1MSP.mod_policy' config.json
# "Admins"  → Org1's admin signature is enough

# wrap the update in an envelope (type 2 = CONFIG_UPDATE)
echo '{"payload":{"header":{"channel_header":{"channel_id":"mychannel","type":2}},"data":{"config_update":'$(cat config_update.json)'}}}' \
  | jq . > config_update_in_envelope.json

configtxlator proto_encode --input config_update_in_envelope.json --type common.Envelope --output config_update_in_envelope.pb

# sign as Admin@org1 and submit to the orderer
peer channel update \
  -f config_update_in_envelope.pb \
  -c mychannel \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile $ORDERER_CA
# Successfully submitted channel update
```

The orderer checks the signature against `mod_policy`, checks the versions, creates a new config block, and every peer updates its copy of Org1MSP.

### Step 8 — Verify

The terminal is now in `~/fabric-lab/crl-update`, so use full paths:

```bash
TN=~/learning/EHR-Hyperledger-Fabric-Project/fabric-samples/test-network

export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE=$TN/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_LOCALMSPID=Org1MSP

# revoked doctor → rejected by the peer before the chaincode runs
export CORE_PEER_MSPCONFIGPATH=~/fabric-lab/doctorA/msp
peer chaincode query -C mychannel -n ehrChainCode \
  -c '{"function":"getPatientById","Args":["{\"patientId\":\"patient01\"}"]}'
# Error: ... access denied: channel [mychannel] creator org [Org1MSP]

# patient still works → only doctorA's serial is in the CRL
export CORE_PEER_MSPCONFIGPATH=~/fabric-lab/patient01/msp
peer chaincode query -C mychannel -n ehrChainCode \
  -c '{"function":"getPatientById","Args":["{\"patientId\":\"patient01\"}"]}'

# the real reason is only in the peer's log
docker logs peer0.org1.example.com 2>&1 | grep -i revoked | tail -3
```

| | Before (not granted) | After revocation |
|---|---|---|
| Error | `not authorized` | `access denied` |
| Rejected by | The chaincode | The peer's MSP check |
| Chaincode ran? | Yes | No |

Fetch → decode → modify → compute → sign → submit is the same workflow for every channel configuration change (adding an org, changing policies, rotating CA certificates).