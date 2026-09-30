## Adding peer 
- Org1 CA - create a peer identity + enroll it and register it 
- run the peer 
- join and install chain code 

- register peer1 on org1 CA 

```
cd ~/learning/EHR-Hyperledger-Fabric-Project/fabric-samples/test-network
export PATH=${PWD}/../bin:$PATH

export FABRIC_CA_CLIENT_HOME=~/fabric-lab/org1-admin

fabric-ca-client register --caname ca-org1 \
  --id.name peer1 --id.secret peer1pw --id.type peer \
  --tls.certfiles ${PWD}/organizations/fabric-ca/org1/ca-cert.pem
```

- enroll peer1 twice (identity + TLS)
```
PEER1_DIR=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com
ORG1_TLS=${PWD}/organizations/fabric-ca/org1/ca-cert.pem

# 2a. identity certificate (MSP)
fabric-ca-client enroll -u https://peer1:peer1pw@localhost:7054 --caname ca-org1 \
  -M $PEER1_DIR/msp --tls.certfiles $ORG1_TLS

cp ${PWD}/organizations/peerOrganizations/org1.example.com/msp/config.yaml $PEER1_DIR/msp/config.yaml

# 2b. TLS certificate
fabric-ca-client enroll -u https://peer1:peer1pw@localhost:7054 --caname ca-org1 \
  -M $PEER1_DIR/tls --enrollment.profile tls \
  --csr.hosts peer1.org1.example.com --csr.hosts localhost \
  --tls.certfiles $ORG1_TLS

# 2c. rename the TLS files to what the peer expects
cp $PEER1_DIR/tls/tlscacerts/* $PEER1_DIR/tls/ca.crt
cp $PEER1_DIR/tls/signcerts/*  $PEER1_DIR/tls/server.crt
cp $PEER1_DIR/tls/keystore/*   $PEER1_DIR/tls/server.key

ls $PEER1_DIR/msp $PEER1_DIR/tls
openssl x509 -in $PEER1_DIR/msp/signcerts/cert.pem -noout -subject
```

![alt text](image.png)

- define and start couchdb2 and peer1.org1
![alt text](image-1.png)

- join peer1.org1 to mychannel
```
cd ~/learning/EHR-Hyperledger-Fabric-Project/fabric-samples/test-network

export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export ORDERER_CA=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem

# point the CLI at the NEW peer
export CORE_PEER_ADDRESS=localhost:8051
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/ca.crt

# 5a. get block 0 from the orderer
peer channel fetch 0 ~/fabric-lab/mychannel-block0.pb \
  -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
  -c mychannel --tls --cafile $ORDERER_CA

# 5b. join
peer channel join -b ~/fabric-lab/mychannel-block0.pb

# 5c. check
peer channel list
```

![alt text](image-2.png)

- install the chaincode on peer1
![alt text](image-3.png)