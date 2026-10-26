// SPDX-FileCopyrightText: 2022 SAP SE or an SAP affiliate company and CLA-assistant contributors
//
// SPDX-License-Identifier: Apache-2.0

// services
const url = require('../services/url')
const github = require('../services/github')
const logger = require('../services/logger')

const getPR = async (args) => {
    try {
        return github.callWithGitHubApp({
            obj: 'pulls',
            fun: 'get',
            arg: {
                owner: args.owner,
                repo: args.repo,
                pull_number: args.number
            },
            owner: args.owner,
            token: args.token
        })

    } catch (error) {
        logger.info(new Error(error).stack)
    }
}

const getStatuses = async (args) => {
    try {
        return github.callWithGitHubApp({
            obj: 'repos',
            fun: 'listCommitStatusesForRef',
            arg: {
                owner: args.owner,
                repo: args.repo,
                ref: args.sha
            },
            owner: args.owner,
            token: args.token
        })

    } catch (error) {
        logger.info(new Error(error).stack)
    }

}

const getCombinedStatus = async (args) => {
    try {
        return github.callWithGitHubApp({
            obj: 'repos',
            fun: 'getCombinedStatusForRef',
            arg: {
                owner: args.owner,
                repo: args.repo,
                ref: args.sha
            },
            owner: args.owner,
            token: args.token
        })
    } catch (error) {
        logger.info(new Error(error).stack)
    }


}

const createStatus = async (args, context, description, state, target_url) => {
    try {
        logger.debug({
            event: 'STATUS_CREATE',
            repo: `${args.owner}/${args.repo}`,
            pull_number: args.number,
            msg: `Creating status for PR ${args.owner}/${args.repo}/pull/${args.number}`
        })
        return github.callWithGitHubApp({
            obj: 'repos',
            fun: 'createCommitStatus',
            arg: {
                owner: args.owner,
                repo: args.repo,
                sha: args.sha,
                state: state,
                description: description,
                target_url: target_url,
                context: context
            },
            owner: args.owner,
            token: args.token
        })
    } catch (error) {
        logger.warn({
            event: 'STATUS_CREATE_PERMISSION_ERROR',
            error: error,
            msg: 'Error on Create Status, possible cause - wrong token, saved token does not have enough rights'
        })
    }
}

const findStatusToBeChanged = async (args) => {
    try {
        logger.debug({
            event: 'STATUS_FIND',
            repo: `${args.owner}/${args.repo}`,
            pull_number: args.number,
            msg: `Finding status to be changed for PR ${args.owner}/${args.repo}/pull/${args.number}`
        })
        const response = await getStatuses(args)
        // let statuses = ''
        const description = args.signed ? 'Contributor License Agreement is signed.' : 'Contributor License Agreement is not signed yet.'
        let status = {
            context: 'license/cla',
            description: description,
            state: args.signed ? 'success' : 'pending',
            target_url: url.claURL(args.owner, args.repo, args.number)
        }

        if (response && response.data) {
            response.data.some(function findClaStatusToChange(s) {
                if (s.context.match(/license\/cla/g)) {
                    status = s.state !== status.state ? status : undefined

                    return true
                }
            })
        }
        return status
    } catch (error) {
        logger.warn({
            event: 'STATUS_FIND_ERROR',
            error: error,
            msg: 'Error finding status'
        })
    }
}

const findClaStatus = async (args) => {
    try {
        const resp = await getCombinedStatus(args)
        let claStatus = null
        resp.data.statuses.some(function (status) {
            if (status.context.match(/license\/cla/g)) {
                claStatus = status
                return true
            }
        })
        return claStatus

    } catch (error) {
        logger.warn(error)
    }
}

const updateStatus = async (args) => {
    try {
        logger.debug({
            event: 'STATUS_UPDATE',
            repo: `${args.owner}/${args.repo}`,
            pull_number: args.number,
            msg: `Updating status for PR ${args.owner}/${args.repo}/pull/${args.number}`
        })
        const status = await findStatusToBeChanged(args)

        if (!status) {
            logger.debug({
                event: 'STATUS_NO_CHANGE',
                repo: `${args.owner}/${args.repo}`,
                pull_number: args.number,
                msg: `Status remains the same - no need to update ${args.owner}/${args.repo}/pull/${args.number}`
            })
            return
        }
        return createStatus(args, status.context, status.description, status.state, status.target_url)

    } catch (error) {
        logger.debug({
            event: 'STATUS_UPDATE_FAILED',
            repo: `${args.owner}/${args.repo}`,
            pull_number: args.number,
            error: error,
            msg: `Failed on updateStatus for the repo ${args.owner}/${args.repo}/pull/${args.number}`
        })
        logger.warn({
            event: 'STATUS_UPDATE_ERROR',
            error: error,
            args: args,
            msg: `Error updating status with args: ${args}`
        })
    }
}

const getPullRequestHeadShaIfNeeded = async (args) => {
    try {
        if (args.sha) {
            return args
        }
        const pullRequest = (await getPR(args)).data
        args.sha = pullRequest.head.sha
        return args
    } catch (error) {
        logger.error({
            event: 'PR_HEAD_ERROR',
            error: error,
            msg: 'Cannot get pull request head'
        })
    }
}

const updateStatusIfNeeded = async (args, status, allowAbsent) => {
    logger.debug({
        event: 'STATUS_UPDATE_CHECK',
        repo: `${args.owner}/${args.repo}`,
        pull_number: args.number,
        msg: `Checking if status needs update for PR ${args.owner}/${args.repo}/pull/${args.number}`
    })

    if (!status) {
        return new Error('Status is required for updateStatusIfNeeded.')

    }
    try {
        const argsWithSha = await getPullRequestHeadShaIfNeeded(args)
        const claStatus = await findClaStatus(args)

        if (!claStatus || allowAbsent) {
            return createStatus(argsWithSha, status.context, status.description, status.state, status.target_url)
        }
        if (!claStatus || claStatus.state !== status.state || claStatus.description !== status.description || claStatus.target_url !== status.target_url) {
            return createStatus(argsWithSha, status.context, status.description, status.state, status.target_url)
        }
    } catch (error) {
        logger.warn(error)
    }
}

class StatusService {
    async update(args) {
        logger.debug({
            event: 'STATUS_DEBUG',
            msg: `StatusService-->update for the repo ${args.owner}/${args.repo}/pull/${args.number}`
        })
        if (args && !args.sha) {
            try {
                const resp = (await getPR(args)).data
                if (!resp || resp.message == 'Not found') {
                    return
                }
                if (resp && resp.head) {
                    args.sha = resp.head.sha
                    return updateStatus(args)
                } else if (args) {
                    return updateStatus(args)
                }
            } catch (error) {
                logger.warn({
                    event: 'STATUS_WARNING',
                    error: new Error(`${error} with args: ${args}`),
                    msg: 'Error in status operation with args'
                })
            }
        }
        if (args.sha) {
            return updateStatus(args)
        }
    }

    async updateForNullCla(args) {
        let status = {
            context: 'license/cla',
            state: 'success',
            description: 'No Contributor License Agreement required.'
        }
        return updateStatusIfNeeded(args, status, true)
    }

    async updateForClaNotRequired(args) {
        logger.debug({
            event: 'PR_WEBHOOK_END',
            msg: 'CLA not required for the repo',
            repo: args.repo,
            owner: args.owner,
            number: args.number,
        })
        let status = {
            context: 'license/cla',
            state: 'success',
            description: 'All CLA requirements met.'
        }
        return updateStatusIfNeeded(args, status, false)
    }

    async updateForMergeQueue(args) {
        logger.debug({
            event: 'STATUS_DEBUG',
            msg: `StatusService-->updateForMergeQueue for the repo ${args.owner}/${args.repo}/${args.sha}`
        })
        let status = {
            context: 'license/cla',
            state: 'success',
            description: 'Dummy status to green light merge group. CLA checks only happen on Pull Requests.',
            url: url.claURL(args.owner, args.repo)
        }
        return createStatus(args, status.context, status.description, status.state, status.url)
    }
}

module.exports = new StatusService()
