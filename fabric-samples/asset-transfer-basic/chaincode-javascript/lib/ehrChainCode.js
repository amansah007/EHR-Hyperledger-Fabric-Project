/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

// Deterministic stringify()
const stringify  = require('json-stringify-deterministic');
const sortKeysRecursive  = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class ehrChainCode extends Contract {


    //   1. Goverment - network owner - admin access
    //     2. Hospital - Network orgination - Read/Write (doctor data)
    //     3. Practicing physician/Doctor - Read/Write (Patient data w.r.t to hospital)
    //     4. Diagnostics center - Read/Write (Patient records w.r.t to diagnostics center)
    //     5. Pharmacies - Read/Write (Patient prescriptions w.r.t to pharma center)
    //     6. Researchers / R&D - Read data of hospital conect, pateint based on consent. 
    //     7. Insurance companies - Read/Write (Patient claims)
    //     8. Patient - Read/Write (All generated patient data)

    // data structure if patient 

    // patient-001: [{
    //     "patientId": "P001",
    //     "name": "John Doe",
    //     "dob": "1990-01-01",
    //     "authorizedDoctors": ["D001", "D002"]
    //  }]

    // "record-001":[
    //         {
    //         "recordId": "R001",
    //         "doctorId": "D001",
    //         "diagnosis": "Flu",
    //         "prescription": "Rest and hydration",
    //         "timestamp": "2024-01-01T10:00:00Z"
    //         }
    //     ],

    // generate recordId.
    recordIdGenerator(ctx){  
        const txId = ctx.stub.getTxID();  // always unique per transaction
         return `record-${txId}`; 
    }

    // onboard doctor in ledger by hospital 
    async onboardDoctor(ctx, args) {
        
        const { doctorId, hospitalName, name, city } = JSON.parse(args);
        console.log("ARGS-RAW:",args)
        console.log("ARGS:",doctorId, hospitalName, name, city)
        const { role, uuid: callerId } = this.getCallerAttributes(ctx);
        const orgMSP = ctx.clientIdentity.getMSPID();

        if (orgMSP !== 'Org1MSP' || role !== 'hospital') {
            throw new Error('Only hospital can onboard doctor.');
        }

        const doctorJSON = await ctx.stub.getState(doctorId);
        if (doctorJSON && doctorJSON.length > 0) {
            throw new Error(`Doctor ${doctorId} already registerd by ${callerId}`);
        }

        const recordId = this.recordIdGenerator(ctx);
        console.log("Record ID", recordId);
        
        const record = {
            recordId,
            doctorId,
            hospitalId: callerId,
            name,
            hospitalName,
            city,
           timestamp: ctx.stub.getTxTimestamp().seconds.low.toString()
        };

        const result = await ctx.stub.putState(doctorId, Buffer.from(stringify(record)));
        console.log('ONBOARD DOCTOR RESULT:',stringify(result))
        return stringify(record);
    }

      // onboard insurance agent by insurance company  
    async onboardInsurance(ctx, args){
        const {agentId, insuranceCompany, name, city} = JSON.parse(args);
        console.log("ARGS-RAW:",args)
        console.log("ARGS-split 4:",agentId, insuranceCompany, name, city)
        const { role, uuid: callerId } = this.getCallerAttributes(ctx);
         const orgMSP = ctx.clientIdentity.getMSPID();

        if (orgMSP !== 'Org2MSP' || role !== 'insuranceAdmin') {
            throw new Error('Only insurance org admin can onbord insurance agent');
        }
        
        const insuranceJSON = await ctx.stub.getState(agentId);
        console.log("INSURANCE DATA",insuranceJSON)
        if (insuranceJSON && insuranceJSON.length > 0) {
            throw new Error(`insurance ${agentId} already registerd by ${callerId}`);
        }

        const recordId = this.recordIdGenerator(ctx);
        console.log("Record ID", recordId);
        
        const record = {
            recordId,
            agentId,
            insuranceId: callerId,
            name,
            insuranceCompany,
            city,
            timestamp: ctx.stub.getTxTimestamp().seconds.low.toString()
        };

        await ctx.stub.putState(agentId, Buffer.from(stringify(record)));
        return stringify(record);
    }

    getCallerAttributes(ctx) {
      const role = ctx.clientIdentity.getAttributeValue('role');
      const uuid = ctx.clientIdentity.getAttributeValue('uuid');

      if (!role || !uuid) {
          throw new Error('Missing role or uuid in client certificate');
      }

      return { role, uuid };
    }

     // add record | only doctor can add record
     // 1. first patient need to grand access to doctor to add record.
    // async addRecord(ctx, patientId, recordId, diagnosis, prescription) {
    //     const { role, uuid: callerId } = this.getCallerAttributes(ctx);

    //     if (role !== 'doctor') {
    //         throw new Error('Only doctors can add records');
    //     }

    //     const patientJSON = await ctx.stub.getState(patientId);
    //     if (!patientJSON || patientJSON.length === 0) {
    //         throw new Error(`Patient ${patientId} not found`);
    //     }

    //     const patient = JSON.parse(patientJSON.toString());

    //     if (!patient.authorizedDoctors.includes(callerId)) {
    //         throw new Error(`Doctor ${callerId} is not authorized`);
    //     }

    //     const record = {
    //         recordId,
    //         doctorId: callerId,
    //         diagnosis,
    //         prescription,
    //        timestamp: ctx.stub.getTxTimestamp().seconds.low.toString()
    //     };

    //     patient.records.push(record);
    //     await ctx.stub.putState(patientId, Buffer.from(stringify(patient)));

    //     return `Record ${recordId} added by doctor ${callerId}`;
    // }

    async onboardPatient(ctx, args) {
        
        const {patientId, name, dob, city} = JSON.parse(args);

        console.log("ARGS-RWA", args)
        console.log("ARGS-split 4", patientId, name, dob, city)


        const key = `patient-${patientId}`;

        const existing = await ctx.stub.getState(key);
        if (existing && existing.length > 0) {
            throw new Error(`Patient ${patientId} already exists`);
        }

        const patient = {
            patientId,
            name,
            dob,
            city,
            authorizedDoctors: []
        };

        await ctx.stub.putState(key, Buffer.from(JSON.stringify(patient)));
        return `Patient ${patientId} registered`;
    }

    async addRecord(ctx, args) {

        const {patientId, diagnosis, prescription} = JSON.parse(args);
        console.log("ARGS_RAW",args)
        console.log("ARGS", patientId, diagnosis, prescription)
        const { role, uuid: callerId } = this.getCallerAttributes(ctx);

        if (role !== 'doctor') {
            throw new Error('Only doctors can add records');
        }

        const patientJSON = await ctx.stub.getState(`patient-${patientId}`);
        if (!patientJSON || patientJSON.length === 0) {
            throw new Error(`Patient ${patientId} not found`);
        }

        console.log("==patient record==",patientJSON);
        const patient = JSON.parse(patientJSON.toString());
        
        console.log("==patient record parsed==",patient);
        
        if (!patient.authorizedDoctors.includes(callerId)) {
            throw new Error(`Doctor ${callerId} is not authorized for patient ${patientId}`);
        }

        const txId = ctx.stub.getTxID();
        const recordId = `R-${txId}`;
        const timestamp = new Date(ctx.stub.getTxTimestamp().seconds.low * 1000).toISOString();

        const recordKey = ctx.stub.createCompositeKey('record', [patientId, recordId]);

        const record = {
            recordId,
            patientId,
            doctorId: callerId,
            diagnosis,
            prescription,
            timestamp
        };

        await ctx.stub.putState(recordKey, Buffer.from(JSON.stringify(record)));
        return JSON.stringify({message: `Record ${recordId} added for patient ${patientId}`});
    }

    async getAllRecordsByPatientId(ctx, args) {
        const {patientId} = JSON.parse(args);
        const iterator =  ctx.stub.getStateByPartialCompositeKey('record', [patientId]);
        const results = [];

        for await (const res of iterator) {
            results.push(JSON.parse(res.value.toString('utf8')));
        }

        return JSON.stringify(results);
    }

    async getRecordById(ctx, args) {
        const {patientId, recordId} = JSON.parse(args);
        const recordKey = ctx.stub.createCompositeKey('record', [patientId, recordId]);
        const recordJSON = await ctx.stub.getState(recordKey);

        if (!recordJSON || recordJSON.length === 0) {
            throw new Error(`Record ${recordId} not found for patient ${patientId}`);
        }

        return recordJSON.toString();
    }

    async grantAccess(ctx, args) {
        const {patientId, doctorIdToGrant} = JSON.parse(args);
        console.log("ARGS-grand access", args);
        console.log("ARGS grand access", patientId, doctorIdToGrant);

        const { role, uuid: callerId } = this.getCallerAttributes(ctx);

        if (role !== 'patient') {
            throw new Error('Only patients can grant access');
        }

        if (callerId !== patientId) {
            throw new Error('Caller is not the owner of this patient record');
        }

        const key = `patient-${patientId}`;
        const patientJSON = await ctx.stub.getState(key);
        if (!patientJSON || patientJSON.length === 0) {
            throw new Error(`Patient ${patientId} not found`);
        }

        const patient = JSON.parse(patientJSON.toString());

        if (!patient.authorizedDoctors.includes(doctorIdToGrant)) {
            patient.authorizedDoctors.push(doctorIdToGrant);
            await ctx.stub.putState(key, Buffer.from(JSON.stringify(patient)));
        }

        return JSON.stringify({message:`Doctor ${doctorIdToGrant} authorized`});
    }

    // GetAllAssets returns all assets found in the world state.
    async fetchLedger(ctx) {
        // call by admin only 
        const { role, uuid: callerId } = this.getCallerAttributes(ctx);

        if (role !== 'hospital') {
            throw new Error('Only hospital can fetch blockchain ledger');
        }

        const allResults = [];
        // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return stringify(allResults);
    }

    async queryHistoryOfAsset(ctx, args) {
        const {assetId} = JSON.parse(args);
        const iterator = await ctx.stub.getHistoryForKey(assetId);
        const results = [];

        while (true) {
            const res = await iterator.next();

            if (res.value) {
                const tx = {
                    txId: res.value.txId,
                    timestamp: res.value.timestamp ? res.value.timestamp.toISOString() : null,
                    isDelete: res.value.isDelete,
                };

                try {
                    if (res.value.value && res.value.value.length > 0 && !res.value.isDelete) {
                        tx.asset = JSON.parse(res.value.value.toString('utf8'));
                    }
                } catch (err) {
                    tx.asset = null;
                }

                results.push(tx);
            }

            if (res.done) {
                await iterator.close();
                break;
            }
        }

        return results;
    }


    // get patient details by id
    async getPatientById(ctx, args){
        
        // Checks 
        const {patientId} = JSON.parse(args)

        if (!patientId || typeof patientId != 'string'){
            throw new Error('Input is invalid')
        }

        const {role, uuid:callerId} = this.getCallerAttributes(ctx);
        const orgMSP = ctx.clientIdentity.getMSPID();

        // read from the ledger 
        const patientJSON = await ctx.stub.getState(`patient-${patientId}`)

        if(!patientJSON || patientJSON.length == 0){
            throw new Error("Patient Not found")
        }

        const patient = JSON.parse(patientJSON.toString());     
        const isOwner = role === 'patient' && callerId === patientId && orgMSP === 'Org1MSP';
        const isAuthorizedDoctor = role === 'doctor' && orgMSP === 'Org1MSP' && Array.isArray(patient.authorizedDoctors) && patient.authorizedDoctors.includes(callerId);
        
        if (!isOwner && !isAuthorizedDoctor){
            throw new Error("not authorized")
        }

        return JSON.stringify(patient);

    }

    async getAllPatient(ctx){
        // who is hte caller -- caller authentication 
        // loop through all the patient and return --> need to be stored in something 

        const {role, uuid:callerId} = this.getCallerAttributes(ctx);
        const orgMSP = ctx.clientIdentity.getMSPID();

        if (role !== 'hospital' || orgMSP !== 'Org1MSP') {
            throw new Error('Not authorized to list patients');
        }


        const iterator =  ctx.stub.getStateByRange('patient-', 'patient.')

        const results = [];

        for await (const res of iterator) {
            results.push(JSON.parse(res.value.toString('utf8')));
        }

         return JSON.stringify(results);

    }

    // get patient record by doctor

    async getPatientrecordByDoctor(ctx, args){
        // who is the caller 
        // get the role of caller 
        // get te msp 
        // check wether caller is authorized or not 
        // return it 

        const {role, uuid:callerId} = this.getCallerAttributes(ctx);
        const orgMSP = ctx.clientIdentity.getMSPID();

        if (role !== 'doctor' || orgMSP !== 'Org1MSP') {
            throw new Error('only doctor');
        }

        const { patientId } = JSON.parse(args);
        if (!patientId || typeof patientId !== 'string') {
            throw new Error('patientId is required and must be a string');
        }

        const patientJSON = await ctx.stub.getState(`patient-${patientId}`);
        if (!patientJSON || patientJSON.length === 0) {
            throw new Error('Not authorized to view this patient');
        }
        const patient = JSON.parse(patientJSON.toString());
        if (!Array.isArray(patient.authorizedDoctors) || !patient.authorizedDoctors.includes(callerId)) {
            throw new Error('Not authorized to view this patient');
        }
        const iterator = ctx.stub.getStateByPartialCompositeKey('record', [patientId]);
        const results = [];
        for await (const res of iterator) {
            results.push(JSON.parse(res.value.toString('utf8')));
        }
        return JSON.stringify(results);
    }

    // issue insurance 
    async issueInsurance(ctx, args) {
        /// who can issue insurance -- agent 
        // to whome they can issue -- to ptient 
        // agent will verify wether its applicable for insurance or not offchain 
        // write to the ledger 

        const { role, uuid: callerId } = this.getCallerAttributes(ctx);
        const orgMSP = ctx.clientIdentity.getMSPID();
        if (role !== 'agent' || orgMSP !== 'Org2MSP') {
            throw new Error('Only agents');
        }

        const agentJSON = await ctx.stub.getState(callerId);
        if (!agentJSON || agentJSON.length === 0) {
            throw new Error('Agent is not onboarded');
        }
        const agent = JSON.parse(agentJSON.toString());
        if (agent.agentId !== callerId || !agent.insuranceCompany) {
            throw new Error('Agent is not onboarded');
        }

        const { patientId, coverageAmount, startDate, endDate } = JSON.parse(args);

        if (!patientId || typeof patientId !== 'string') {
            throw new Error('patientId is required and must be a string');
        }
        const amount = Number(coverageAmount);
        if (!Number.isSafeInteger(amount) || amount <= 0) {
            throw new Error('coverageAmount must be a positive whole number');
        }
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (!datePattern.test(startDate) || !datePattern.test(endDate) || endDate <= startDate) {
            throw new Error('Dates must be YYYY-MM-DD and endDate must be after startDate');
        }
                const patientJSON = await ctx.stub.getState(`patient-${patientId}`);
        if (!patientJSON || patientJSON.length === 0) {
            throw new Error(`Patient ${patientId} not found`);
        }
        const policyId = `POL-${ctx.stub.getTxID()}`;
        const issuedAt = ctx.stub.getDateTimestamp().toISOString();

        const policy = {
            policyId,
            patientId,
            agentId: callerId,
            insuranceCompany: agent.insuranceCompany,
            coverageAmount: amount,
            startDate,
            endDate,
            status: 'ACTIVE',
            issuedAt
        };
        const policyKey = ctx.stub.createCompositeKey('policy', [patientId, policyId]);
        await ctx.stub.putState(policyKey, Buffer.from(stringify(policy)));
        return JSON.stringify({ message: `Policy ${policyId} issued`, policyId });
    }

}

module.exports = ehrChainCode;