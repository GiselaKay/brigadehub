var request = require('request')
/**
 * GET /
 * Home page.
 */
exports.index = function (req, res) {
  getSlackUsersAmt(res.locals.brigade.auth.slack.token).then(function (slackUsersAmt) {
    res.render(res.locals.brigade.theme.slug + '/views/home', {
      title: 'Home',
      brigade: res.locals.brigade,
      slackUsersAmt: slackUsersAmt
    })
  })
}

getSlackUsersAmt = function (token) {
  return new Promise (function (resolve, reject) {
    request('https://slack.com/api/users.list\?token\=' + token, function (error, response, body) {
      if (!error && response.statusCode === 200 && !JSON.parse(body).error) {
        var slackUsers = JSON.parse(body).members
        resolve(slackUsers.length)
      } else {
        resolve(null)
      }
    })
  })
}
