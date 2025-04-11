// SPDX-FileCopyrightText: 2022 SAP SE or an SAP affiliate company and CLA-assistant contributors
//
// SPDX-License-Identifier: Apache-2.0

require('../documents/user')

// services
const pullRequest = require('../services/pullRequest')
const status = require('../services/status')
const cla = require('../services/cla')
const repoService = require('../services/repo')
const logger = require('../services/logger')
const User = require('mongoose').model('User')


//////////////////////////////////////////////////////////////////////////////////////////////
// GitHub Pull Request Webhook Handler
//////////////////////////////////////////////////////////////////////////////////////////////

function storeRequest(committers, repo, owner, number) {
    committers.forEach(async committer => {
        let user
        try {
            user = await User.findOne({
                name: committer
            })
        } catch (error) {
            logger.warn({
                event: 'PR_WEBHOOK_WARNING',
                error: error,
                msg: 'Warning in PR webhook operation'
            })
        }
        const pullRequest = {
            repo: repo,
            owner: owner,
            numbers: [number]
        }
        if (!user) {
            try {
                User.create({
                    name: committer,
                    requests: [pullRequest]
                })
            } catch (error) {
                logger.warn({
                    event: 'PR_WEBHOOK_WARNING',
                    error: error,
                    msg: 'Warning in PR webhook operation'
                })
            }
            return
        }
        if (!user.requests || user.requests.length < 1) {
            user.requests = user.requests ? user.requests : []
            user.requests.push(pullRequest)
            await user.save()

            return
        }
        const repoPullRequests = user.requests.find(request => request.repo === repo && request.owner === owner)
        if (repoPullRequests && repoPullRequests.numbers.indexOf(number) < 0) {
            repoPullRequests.numbers.push(number)
            user.save()
        }
        if (!repoPullRequests) {
            user.requests.push(pullRequest)
            user.save()
        }
    })
}

async function updateStatusAndComment(args, item) {
    try {
        const committers = await repoService.getPRCommitters(args)
        if (committers && committers.length > 0) {
            const promises = []
            let checkResult
            try {
                checkResult = await cla.check(args, item)
                logger.debug({
                    event: 'PR_WEBHOOK_DEBUG',
                    msg: 'reporting status and comment on PR',
                    repo: args.repo,
                    owner: args.owner,
                    number: args.number,
                })
            } catch (error) {
                logger.error({
                    event: 'PR_WEBHOOK_WARNING',
                    error: error,
                    msg: 'Warning in PR webhook operation'
                })
            }
            args.signed = checkResult.signed
            if (!checkResult.userMap ||
                (checkResult.userMap.signed && checkResult.userMap.signed.length > 0) ||
                (checkResult.userMap.not_signed && checkResult.userMap.not_signed.length > 0) ||
                (checkResult.userMap.unknown && checkResult.userMap.unknown.length > 0)
            ) {
                promises.push(status.update(args))
            } else {
                promises.push(status.updateForClaNotRequired(args))
            }
            promises.push(pullRequest.badgeComment(
                args.owner,
                args.repo,
                args.number,
                checkResult.signed,
                checkResult.userMap
            ))
            if (checkResult.userMap && checkResult.userMap.not_signed) {
                storeRequest(checkResult.userMap.not_signed, args.repo, args.owner, args.number)
            }
            try {
                await Promise.all(promises)
                logger.info({
                    event: 'PR_WEBHOOK_END',
                    msg: 'updated status and comment on PR',
                    repo: args.repo,
                    owner: args.owner,
                    number: args.number,
                })
            } catch (error) {
                logger.error({
                    event: 'PR_WEBHOOK_END',
                    error: new Error('could not update status and/or comment on PR'),
                    msg: 'Could not update status and/or comment on PR',
                    args: args
                })
                logger.warn(error)
            }
        } else {
            logger.warn({
                event: 'PR_WEBHOOK_WARNING',
                error: new Error('No committers found for the PR'),
                msg: 'No committers found for the PR',
                args: args
            })
        }
    } catch (error) {
        if (!args.handleCount || args.handleCount < 2) {
            args.handleCount = args.handleCount ? ++args.handleCount : 1
            setTimeout(function () {
                updateStatusAndComment(args)
            }, 10000 * args.handleCount * args.handleDelay)
        } else {
            logger.error({
                event: 'PR_WEBHOOK_END',
                error: error,
                msg: 'PR webhook operation failed',
                args: args
            })
        }
    }
}

async function handleWebHook(args, item) {
    logger.info({
        event: 'PR_WEBHOOK_START',
        msg: 'handleWebHook for the repo',
        repo: args.repo,
        owner: args.owner,
        number: args.number,
    })

    try {
        const claRequired = await cla.isClaRequired(args, item)
        if (claRequired) {
            logger.debug({
                event: 'PR_WEBHOOK_DEBUG',
                msg: 'handleWebHook for the repo',
                data: args.repo
            })
            return await updateStatusAndComment(args, item)
        }

        logger.debug({
            event: 'PR_WEBHOOK_DEBUG',
            msg: 'no CLA required for the repo',
            data: args.repo
        })
        await status.updateForClaNotRequired(args)
        return await pullRequest.deleteComment({
            repo: args.repo,
            owner: args.owner,
            number: args.number
        })
    } catch (error) {
        logger.error({
            event: 'PR_WEBHOOK_ERROR',
            error: error,
            msg: 'Error in PR webhook operation'
        })
        return logger.error(error)
    }
}

module.exports = {
    accepts: function (req) {
        return ['opened', 'reopened', 'synchronize'].indexOf(req.args.action) > -1 && (req.args.repository && req.args.repository.private == false)
    },
    handle: async function (req, res) {
        const startTime = Date.now();
        let status = 'success';
        let error = null;

        res.status(200).send('OK - Will be working on it')
        const args = {
            owner: req.args.repository.owner.login,
            repoId: req.args.repository.id,
            repo: req.args.repository.name,
            number: req.args.number
        }
        args.orgId = req.args.organization ? req.args.organization.id : req.args.repository.owner.id
        args.handleDelay = req.args.handleDelay != undefined ? req.args.handleDelay : 1 // needed for unitTests

        try {
            const item = await cla.getLinkedItem(args)
            let nullCla = !item.gist
            let isExcluded = item.orgId && item.isRepoExcluded && item.isRepoExcluded(args.repo)
            if (!nullCla && !isExcluded) {
                args.token = item.token
                args.gist = item.gist
                if (item.repoId) {
                    args.orgId = undefined
                }

                await handleWebHook(args, item)
            }
        } catch (e) {
            status = 'failure';
            error = e;
            logger.warn({
                event: 'PR_WEBHOOK_WARNING',
                error: e,
                msg: 'Warning in PR webhook operation'
            })
        } finally {
            const duration = Date.now() - startTime;
            logger.info({
                event: 'PR_WEBHOOK_COMPLETED',
                msg: 'PR webhook processing completed',
                status: status,
                duration_ms: duration,
                args: {
                    owner: args.owner,
                    repo: args.repo,
                    number: args.number,
                    action: req.args.action
                },
                error: error
            });
        }
    }
}
