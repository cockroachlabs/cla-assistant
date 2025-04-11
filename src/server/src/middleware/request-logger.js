// SPDX-FileCopyrightText: 2022 SAP SE or an SAP affiliate company and CLA-assistant contributors
//
// SPDX-License-Identifier: Apache-2.0

const logger = require('../services/logger')

module.exports = (req, res, next) => {
    const start = process.hrtime()

    // Log request start
    logger.startRequest(req)

    // Log response when finished
    res.on('finish', () => {
        const duration = process.hrtime(start)
        const durationMs = (duration[0] * 1e9 + duration[1]) / 1e6
        logger.endRequest(req, res, durationMs)
    })

    next()
}
