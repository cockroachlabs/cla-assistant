// SPDX-FileCopyrightText: 2022 SAP SE or an SAP affiliate company and CLA-assistant contributors
//
// SPDX-License-Identifier: Apache-2.0

const url = require('../services/url')
const repoService = require('../services/repo')
const orgApi = require('../api/org')
const logger = require('../services/logger')
const passport = require('passport')
const Strategy = require('passport-github').Strategy
const merge = require('merge')
const User = require('mongoose').model('User')
const github = require('../services/github')

function updateToken(item, newToken) {
    item.token = newToken
    item.save()
    logger.debug({
        event: 'TOKEN_UPDATE',
        item_type: item.repo ? 'repo' : 'org',
        item_name: item.repo || item.org,
        msg: `Update access token for ${item.repo ? 'repo' : 'org'} ${item.repo || item.org}`
    })
}

async function checkToken(item, accessToken) {
    const newToken = accessToken
    const oldToken = item.token

    try {
        const args = {
            obj: 'apps',
            fun: 'checkToken',
            arg: {
                access_token: oldToken,
                client_id: config.server.github.client
            },
            basicAuth: {
                user: config.server.github.client,
                pass: config.server.github.secret
            }
        }

        const res = await github.call(args)

        if (res) {
            if (!(res.scopes && res.scopes.indexOf('write:repo_hook') >= 0)) {
                updateToken(item, newToken)
            } else if (item.repo) {
                const ghRepo = await repoService.getGHRepo(item)
                if (!(ghRepo && ghRepo.permissions && ghRepo.permissions.admin)) {
                    updateToken(item, newToken)
                    logger.info({
                        event: 'TOKEN_UPDATE_ADMIN',
                        repo: item.repo,
                        msg: `Update access token for repo ${item.repo} admin rights have been changed`
                    })
                }
            }
        }
    } catch (error) {
        updateToken(item, newToken)
        logger.warn({
            event: 'TOKEN_UPDATE_ERROR',
            error: error,
            msg: 'Error updating token'
        })
    }
}

const githubVerifyCallback = async (accessToken, _refreshToken, params, profile, done) => {
    let user
    try {
        user = await User.findOne({
            name: profile.username
        })
        if (user) {
            if (!user.uuid) {
                user.uuid = profile.id
            }
            user.token = accessToken
            user.save()
        }
    } catch (error) {
        logger.warn({
            event: 'USER_UPDATE_ERROR',
            error: error,
            msg: 'Error updating user'
        })
    }

    if (!user) {
        try {
            await User.create({
                uuid: profile.id,
                name: profile.username,
                token: accessToken
            })
        } catch (error) {
            logger.warn({
                event: 'USER_CREATE_ERROR',
                error: error,
                msg: 'Could not create new user'
            })
        }
    }

    // find all available repos
    if (params.scope.indexOf('write:repo_hook') >= 0) {
        try {
            const repoRes = await repoService.getUserRepos({
                token: accessToken
            })
            if (repoRes && repoRes.length > 0) {
                // only update the token for repositories which have tokens (legacy behavior)
                repoRes.filter((repo) => repo.token).forEach((repo) => checkToken(repo, accessToken))
            }
        } catch (error) {
            logger.warn({
                event: 'REPO_UPDATE_ERROR',
                error: error,
                msg: 'Error updating repo'
            })
        }
    }
    if (params.scope.indexOf('admin:org_hook') >= 0) {
        try {
            const orgRes = await orgApi.getForUser({
                user: {
                    token: accessToken,
                    login: profile.username
                }
            })
            if (orgRes && orgRes.length > 0) {
                orgRes.forEach((org) => checkToken(org, accessToken))
            }
        } catch (error) {
            logger.warn({
                event: 'ORG_UPDATE_ERROR',
                error: error,
                msg: 'Error updating org'
            })
        }
    }
    done(null, merge(profile._json, {
        token: accessToken,
        scope: params.scope
    }))
}

passport.use('github-app-auth', new Strategy({
    clientID: config.server.github.app.clientId,
    clientSecret: config.server.github.app.clientSecret,
    callbackURL: url.githubAppCallback,
    authorizationURL: url.githubAuthorization,
    tokenURL: url.githubToken,
    userProfileURL: url.githubProfile()
}, githubVerifyCallback))

passport.use('github-oauth', new Strategy({
    clientID: config.server.github.client,
    clientSecret: config.server.github.secret,
    callbackURL: url.githubCallback,
    authorizationURL: url.githubAuthorization,
    tokenURL: url.githubToken,
    userProfileURL: url.githubProfile()
}, githubVerifyCallback))

passport.serializeUser((user, done) => done(null, user))

passport.deserializeUser((user, done) => done(null, user))
