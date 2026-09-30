for syntax check - node --check asset-transfer-basic/chaincode-javascript/lib/ehrChainCode.js  
./network.sh up createChannel -ca -s couchdb
./network.sh deployCC -ccn ehrChainCode -ccp ../asset-transfer-basic/chaincode-javascript/ -ccl javascript


## Enroll CA 

export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client enroll \
  -u https://admin:adminpw@localhost:7054 \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem

find ~/fabric-lab/org1-admin -type f

openssl x509 -in ~/fabric-lab/org1-admin/msp/signcerts/cert.pem -noout -subject -issuer -dates

## read 
subject=C = US, ST = North Carolina, O = Hyperledger, OU = client, CN = admin
issuer=C = US, ST = North Carolina, O = Hyperledger, OU = Fabric, CN = fabric-ca-server
notBefore=Sep 29 06:04:00 2026 GMT
notAfter=Sep 29 06:29:00 2027 GMT

Admin regiusters and user enrolls 

## Register 
```
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client register \
  --caname ca-org1 \
  --id.name patient01 \
  --id.secret patient01pw \
  --id.type client \
  --id.attrs 'role=patient:ecert,uuid=patient01:ecert' \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
  ```

  ## Enroll 

  ```
export FABRIC_CA_CLIENT_HOME=~/fabric-lab/patient01

fabric-ca-client enroll \
  -u https://patient01:patient01pw@localhost:7054 \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
  ```

  Registered Actors 
  ![alt text](image.png)
- regsitered all required client 

## query 
peer chaincode query -C mychannel -n ehrChainCode -c '{"function":"getAllPatient","Args":[]}'
![alt text](image-1.png)

## Invoke 
```
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

  ## Patient Grants access then doctor reads 
  ![alt text](image-2.png)

  ```
  export CORE_PEER_MSPCONFIGPATH=~/fabric-lab/patient01/msp
peer chaincode invoke $INVOKE_FLAGS \
  -c '{"function":"grantAccess","Args":["{\"patientId\":\"patient01\",\"doctorIdToGrant\":\"doctorA\"}"]}'
  ```

  ![alt text](image-3.png)

  ## Certificate Revocation 
  ```
  export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client revoke \
  -e doctorA \
  -r keycompromise \
  --gencrl \
  --caname ca-org1 \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
  ```

  - still able ot get the user details 
  ![alt text](image-4.png)

  Reason - thre is two place where its stored - WHO IS TRUSTED 
  - CA data base and Channel Config

  STEPS 
  - downloads the channel's current configuration from the orderer, as Org1's admin, into a file
  - decode it to readable JSON
  ```
  configtxlator proto_decode --input config_block.pb --type common.Block --output config_block.json

jq '.data.data[0].payload.data.config' config_block.json > config.json

jq '.channel_group.groups.Application.groups.Org1MSP.values.MSP.value.config.revocation_list' config.json
```

- 

```
CRL=$(base64 -w 0 ~/fabric-lab/org1-admin/msp/crls/crl.pem)

jq --arg crl "$CRL" \
  '.channel_group.groups.Application.groups.Org1MSP.values.MSP.value.config.revocation_list = [$crl]' \
  config.json > modified_config.json

jq '.channel_group.groups.Application.groups.Org1MSP.values.MSP.value.config.revocation_list' modified_config.json
```

```
configtxlator proto_encode --input config.json --type common.Config --output config.pb
configtxlator proto_encode --input modified_config.json --type common.Config --output modified_config.pb

configtxlator compute_update --channel_id mychannel \
  --original config.pb --updated modified_config.pb --output config_update.pb

configtxlator proto_decode --input config_update.pb --type common.ConfigUpdate --output config_update.json
jq '.write_set.groups.Application.groups | keys' config_update.json
```

![alt text](image-5.png)