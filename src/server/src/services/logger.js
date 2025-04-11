// SPDX-FileCopyrightText: 2022 SAP SE or an SAP affiliate company and CLA-assistant contributors
//
// SPDX-License-Identifier: Apache-2.0

const bunyan = require('bunyan')
const BunyanSlack = require('bunyan-slack')
const rTracer = require('cls-rtracer')
const os = require('os')
const config = require('../config')

// Get environment and service info
const ENV = process.env.NODE_ENV || 'development'
const SERVICE_NAME = 'cla-assistant'
const HOSTNAME = os.hostname()
const REGION = process.env.REGION || 'unknown'

// Custom serializers for consistent JSON formatting
const serializers = {
    err: bunyan.stdSerializers.err,
    req: (req) => {
        if (!req) return req
        return {
            method: req.method,
            url: req.url,
            headers: req.headers,
            remoteAddress: req.connection && req.connection.remoteAddress,
            remotePort: req.connection && req.connection.remotePort
        }
    },
    res: (res) => {
        if (!res) return res
        return {
            statusCode: res.statusCode,
            headers: res._headers
        }
    }
}

// Custom formatter for Slack notifications
const formatter = (record, levelName) => {
    return {
        text: `[${levelName}] ${record.msg} (source: ${record.src.file} line: ${record.src.line})`
    }
}

// Custom stream that injects request context and standard fields
const createWrappedStream = (stream) => ({
    write: (entry) => {
        const logObject = JSON.parse(entry)

        // Add standard fields
        logObject.service = SERVICE_NAME
        logObject.env = ENV
        logObject.hostname = HOSTNAME
        logObject.region = REGION
        logObject.timestamp = new Date().toISOString()

        // Add request context if available
        const traceId = rTracer.id()
        if (traceId) {
            if (config.server.observability.request_trace_header_name === 'traceparent') {
                const traceParts = traceId.split('-')
                if (traceParts.length === 4 && traceParts[0] === '00') {
                    logObject.request_id = traceParts[1]
                }
            } else {
                logObject.request_id = `${config.server.observability.trace_prefix}${traceId}`
            }
        }

        // Ensure log level is uppercase
        if (typeof logObject.level === 'string') {
            logObject.level = logObject.level.toUpperCase()
        }

        // Add event type if not present
        if (!logObject.event) {
            logObject.event = 'LOG'
        }

        stream.write(JSON.stringify(logObject) + '\n')
    }
})

// Create logger instance
const log = bunyan.createLogger({
    name: SERVICE_NAME,
    serializers,
    streams: [{
        name: 'stdout',
        level: process.env.LOG_LEVEL || (ENV === 'production' ? 'info' : 'debug'),
        stream: createWrappedStream(process.stdout)
    }]
})

// Add Slack stream if configured
if (config.server.slack.url) {
    try {
        log.addStream({
            name: 'slack',
            level: 'error',
            stream: new BunyanSlack({
                webhook_url: config.server.slack.url,
                channel: config.server.slack.channel,
                username: 'CLA Assistant',
                customFormatter: formatter
            })
        })
    } catch (e) {
        log.error({ error: e }, 'Failed to initialize Slack logging')
    }
}

// Helper methods for common logging patterns
const helpers = {
    startRequest: (req) => {
        log.info({
            event: 'REQUEST_STARTED',
            req,
            msg: `Started ${req.method} ${req.url}`
        })
    },

    endRequest: (req, res, duration) => {
        log.info({
            event: 'REQUEST_COMPLETED',
            req,
            res,
            duration_ms: duration,
            msg: `Completed ${req.method} ${req.url} in ${duration}ms`
        })
    },

    error: (error, context) => {
        const logContext = Object.assign({}, context)
        const logEntry = {
            event: 'ERROR',
            error,
            msg: error.message || 'An error occurred'
        }
        Object.assign(logEntry, logContext)
        log.error(logEntry)
    },

    warn: (message, context) => {
        const logContext = Object.assign({}, context)
        const logEntry = {
            event: 'WARNING',
            msg: message
        }
        Object.assign(logEntry, logContext)
        log.warn(logEntry)
    },

    info: (message, context) => {
        const logContext = Object.assign({}, context)
        const logEntry = {
            event: 'INFO',
            msg: message
        }
        Object.assign(logEntry, logContext)
        log.info(logEntry)
    },

    debug: (message, context) => {
        const logContext = Object.assign({}, context)
        const logEntry = {
            event: 'DEBUG',
            msg: message
        }
        Object.assign(logEntry, logContext)
        log.debug(logEntry)
    }
}

module.exports = Object.assign({}, log, helpers)
