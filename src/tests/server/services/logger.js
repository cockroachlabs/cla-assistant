// SPDX-FileCopyrightText: 2022 SAP SE or an SAP affiliate company and CLA-assistant contributors
//
// SPDX-License-Identifier: Apache-2.0

/*global describe, it, beforeEach, afterEach*/
const assert = require('assert')
const sinon = require('sinon')
const bunyan = require('bunyan')

describe('logger service', () => {
    let logStub
    let logger

    beforeEach(() => {
        logStub = {
            info: sinon.stub(),
            error: sinon.stub(),
            warn: sinon.stub(),
            debug: sinon.stub()
        }
        // Stub bunyan.createLogger to return our stub
        sinon.stub(bunyan, 'createLogger').returns(logStub)
        // Clear require cache to force reload of logger
        delete require.cache[require.resolve('../../../server/src/services/logger')]
        logger = require('../../../server/src/services/logger')
    })

    afterEach(() => {
        sinon.restore()
    })

    describe('startRequest', () => {
        it('should log request start with context', () => {
            const req = {
                method: 'GET',
                url: '/test',
                headers: {
                    'x-request-id': '123'
                }
            }
            logger.startRequest(req)
            assert(logStub.info.calledOnce)
            const logCall = logStub.info.getCall(0).args[0]
            assert.equal(logCall.event, 'REQUEST_STARTED')
            assert.equal(logCall.msg, 'Started GET /test')
            assert.deepEqual(logCall.req, {
                method: 'GET',
                url: '/test',
                headers: {
                    'x-request-id': '123'
                }
            })
        })
    })

    describe('endRequest', () => {
        it('should log request end with duration and status', () => {
            const req = {
                method: 'GET',
                url: '/test',
                headers: {
                    'x-request-id': '123'
                }
            }
            const res = {
                statusCode: 200
            }
            const duration = 100
            logger.endRequest(req, res, duration)
            assert(logStub.info.calledOnce)
            const logCall = logStub.info.getCall(0).args[0]
            assert.equal(logCall.event, 'REQUEST_COMPLETED')
            assert.equal(logCall.msg, 'Completed GET /test in 100ms')
            assert.deepEqual(logCall.req, {
                method: 'GET',
                url: '/test',
                headers: {
                    'x-request-id': '123'
                }
            })
            assert.deepEqual(logCall.res, {
                statusCode: 200
            })
            assert.equal(logCall.duration_ms, duration)
        })
    })

    describe('info', () => {
        it('should log info with context', () => {
            const message = 'test message'
            const context = { key: 'value' }
            logger.info(message, context)
            assert(logStub.info.calledOnce)
            const logCall = logStub.info.getCall(0).args[0]
            assert.equal(logCall.event, 'INFO')
            assert.equal(logCall.msg, message)
            assert.equal(logCall.key, 'value')
        })
    })

    describe('error', () => {
        it('should log error with context', () => {
            const error = new Error('test error')
            const context = { key: 'value' }
            logger.error(error, context)
            assert(logStub.error.calledOnce)
            const logCall = logStub.error.getCall(0).args[0]
            assert.equal(logCall.event, 'ERROR')
            assert.equal(logCall.msg, 'test error')
            assert.equal(logCall.error, error)
            assert.equal(logCall.key, 'value')
        })
    })

    describe('warn', () => {
        it('should log warning with context', () => {
            const message = 'test warning'
            const context = { key: 'value' }
            logger.warn(message, context)
            assert(logStub.warn.calledOnce)
            const logCall = logStub.warn.getCall(0).args[0]
            assert.equal(logCall.event, 'WARNING')
            assert.equal(logCall.msg, message)
            assert.equal(logCall.key, 'value')
        })
    })

    describe('debug', () => {
        it('should log debug with context', () => {
            const message = 'test debug'
            const context = { key: 'value' }
            logger.debug(message, context)
            assert(logStub.debug.calledOnce)
            const logCall = logStub.debug.getCall(0).args[0]
            assert.equal(logCall.event, 'DEBUG')
            assert.equal(logCall.msg, message)
            assert.equal(logCall.key, 'value')
        })
    })
})