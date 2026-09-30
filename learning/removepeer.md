## Remove a Anchor peer 

### Check 
- anchor peer - removing it would cut off Org2's view of Org1
- Removing an org's last peer would stop all transactions needing Org1
- inventory - The serial number is needed for revocation
- configuration with peer 1 

```
cd ~/learning/EHR-Hyperledger-Fabric-Project/fabric-samples/test-network

# 1a. Is peer1 an anchor peer?
jq '.channel_group.groups.Application.groups.Org1MSP.values.AnchorPeers' ~/fabric-lab/channel-config/mychannel-config.json

# 1b. Is anything configured to use peer1?
grep -rl "peer1.org1\|8051" organizations/peerOrganizations/org1.example.com/connection-org1.* ../../server-node-sdk/*.js 2>/dev/null

# 1c. Will Org1 still have a working peer?
peer channel getinfo -c mychannel        # peer0.org1 (CORE_PEER_ADDRESS=localhost:7051)

# 1d. Record what belongs to peer1
openssl x509 -in organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/msp/signcerts/cert.pem -noout -serial
docker ps -a --format '{{.Names}}' | grep -E "peer1|couchdb2"
docker volume ls | grep peer1
```

### Stop Peer 
```
# 2a. stop peer1, its chaincode container, and its CouchDB
docker stop peer1.org1.example.com dev-peer1.org1.example.com-ehrChainCode_1.2-cbc69b5951166f76bb5c0348b77a3140b297b864dd1e998c7c8ee7a12963bab2 couchdb2

# 2b. peer1 no longer answers
CORE_PEER_ADDRESS=localhost:8051 peer channel getinfo -c mychannel

# 2c. the network keeps working: query through peer0 as patient01
CORE_PEER_MSPCONFIGPATH=~/fabric-lab/patient01/msp \
peer chaincode query -C mychannel -n ehrChainCode \
  -c '{"function":"getPatientById","Args":["{\"patientId\":\"patient01\"}"]}'

# 2d. peer0 notices peer1 is gone (wait ~30s first)
sleep 30
docker logs peer0.org1.example.com --since 1m 2>&1 | grep -i "peer1" | tail -5
```

### Remove containers 
```
# 3a. delete the three containers
docker rm peer1.org1.example.com couchdb2 dev-peer1.org1.example.com-ehrChainCode_1.2-cbc69b5951166f76bb5c0348b77a3140b297b864dd1e998c7c8ee7a12963bab2

# 3b. delete peer1's chaincode image (built when you installed on peer1)
docker images --format '{{.Repository}}' | grep dev-peer1
docker rmi $(docker images --format '{{.Repository}}' | grep dev-peer1)

# 3c. check: nothing left except the volume
docker ps -a --format '{{.Names}}' | grep -E "peer1|couchdb2"
docker volume ls | grep peer1
```

### delete peer1's blockchain data (the volume)

### revoke peer1 at Org1's CA 
```
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client revoke \
  -e peer1 \
  -r cessationofoperation \
  --gencrl \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem

# check what the new CRL contains
openssl crl -in ~/fabric-lab/org1-admin/msp/crls/crl.pem -noout -text | grep -A2 "Serial Number"
```

### put the new CRL into the channel config

```
cd ~/learning/EHR-Hyperledger-Fabric-Project/fabric-samples/test-network
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export ORDERER_CA=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem

mkdir -p ~/fabric-lab/crl-update2 && cd ~/fabric-lab/crl-update2

# 6a. fetch + decode the CURRENT config
peer channel fetch config config_block.pb -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com -c mychannel --tls --cafile $ORDERER_CA
configtxlator proto_decode --input config_block.pb --type common.Block \
  | jq '.data.data[0].payload.data.config' > config.json

# 6b. replace the revocation list with the NEW cumulative CRL
CRL=$(base64 -w 0 ~/fabric-lab/org1-admin/msp/crls/crl.pem)
jq --arg crl "$CRL" \
  '.channel_group.groups.Application.groups.Org1MSP.values.MSP.value.config.revocation_list = [$crl]' \
  config.json > modified_config.json

# 6c. compute the update
configtxlator proto_encode --input config.json --type common.Config --output config.pb
configtxlator proto_encode --input modified_config.json --type common.Config --output modified_config.pb
configtxlator compute_update --channel_id mychannel \
  --original config.pb --updated modified_config.pb --output config_update.pb
configtxlator proto_decode --input config_update.pb --type common.ConfigUpdate --output config_update.json
jq '.write_set.groups.Application.groups | keys' config_update.json

# 6d. envelope + sign as Org1 admin + submit
echo '{"payload":{"header":{"channel_header":{"channel_id":"mychannel","type":2}},"data":{"config_update":'$(cat config_update.json)'}}}' \
  | jq . > config_update_in_envelope.json
configtxlator proto_encode --input config_update_in_envelope.json --type common.Envelope --output config_update_in_envelope.pb
peer channel update -f config_update_in_envelope.pb -c mychannel \
  -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile $ORDERER_CA

cd ~/learning/EHR-Hyperledger-Fabric-Project/fabric-samples/test-network
```

### Revoke peer1 at Org1's CA

```
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client revoke \
  -e peer1 \
  -r cessationofoperation \
  --gencrl \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem

# check what the new CRL contains
openssl crl -in ~/fabric-lab/org1-admin/msp/crls/crl.pem -noout -text | grep -A2 "Serial Number"
2026/09/30 15:57:38 [INFO] Configuration file location: /home/amankr/fabric-lab/org1-admin/fabric-ca-client-config.yaml
2026/09/30 15:57:38 [INFO] TLS Enabled
2026/09/30 15:57:38 [INFO] TLS Enabled
2026/09/30 15:57:38 [INFO] Successfully revoked certificates: []
2026/09/30 15:57:38 [INFO] Successfully stored the CRL in the file /home/amankr/fabric-lab/org1-admin/msp/crls/crl.pem
Could not read CRL from /home/amankr/fabric-lab/org1-admin/msp/crls/crl.pem
Unable to load CRL
amankr@DHEA01444:~/learning/EHR-Hyperledger-Fabric-Project/fabric-samples/test-network$ 
```

### : prove the revocation works on the network 

```
# 7a. peer1's old identity → should be REJECTED
CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/msp \
peer channel getinfo -c mychannel

# 7b. Org1 admin → should WORK, height 18
peer channel getinfo -c mychannel

# 7c. doctorA → should still be REJECTED
CORE_PEER_MSPCONFIGPATH=~/fabric-lab/doctorA/msp \
peer channel getinfo -c mychannel
```

### Clean Up 
```
# delete peer1's certificates and keys
rm -rf organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com

# delete its compose file
rm compose/compose-peer1-org1.yaml

# final checks
ls organizations/peerOrganizations/org1.example.com/peers/
docker ps -a --format '{{.Names}}' | grep -E "peer1|couchdb2"
docker volume ls | grep peer1
```