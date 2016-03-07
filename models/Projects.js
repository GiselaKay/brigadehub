var mongoose = require('mongoose')
var request = require('request')
var _ = require('lodash')
var linkHeaderParser = require('link-header-parser')

var defaultHeaders = {
  'Accept': 'application/vnd.github.v3+json',
  'Authorization': 'token ',
  'User-Agent': 'BridageHub'
}

var projectsSchema = new mongoose.Schema({
  id: String, // this is the slug - civic.sf.json + civic.dc.json
  brigade: String, // this is the brigade the project currently belongs to - civic.sf.json

  /* Standard BetaNYC civic.json, used by CFAPI */

  status: String, // civic.json + civic.dc.json - proposed, ideation, alpha, beta, production, archival
  thumbnailUrl: String,
  bornAt: String,
  geography: String,
  politicalEntity: String,
  type: String,
  needs: Array,
  categories: Array,

  /* Expanded Open DC civic.json */

  // id: String, // represented above
  name: String, // Display title
  description: String,
  license: String,
  // status: String, // represented above
  homepage: String,
  repository: String,
  contact: {
    name: String,
    email: String
  },
  partners: Array, // name, email, logo?
  data: Array,
  keywords: Array, // simple strings
  links: Array
})

projectsSchema.statics.fetchGithubRepos = function (brigade, user, cb) {
  var Projects = this
  var url = 'https://api.github.com/orgs/' + brigade.slug + '/repos'
  getRepos(url, [], user, function (err, aggregate) {
    if (err) console.error(err)
    // massage data, fetch civic.json files
    var promiseArray = []
    aggregate.forEach(function (repo) {
      function buildPromise (repo) {
        return new Promise(function (resolve, reject) {
          var civicJsonUrl = repo.contents_url.replace('{+path}', 'civic.json')
          getRepoCivicJson(civicJsonUrl, user, function (err, results) {
            if (err) console.error(err)

            resolve({repo: repo, json: results})
          })
        })
      }
      promiseArray.push(buildPromise(repo))
    })
    Promise.all(promiseArray)
      .then(function (results) {
        // update/save all in schema
        var mongooseActions = []
        results.forEach(function (project) {
          function buildPromise (project) {
            return new Promise(function (resolve, reject) {
              Projects.find({id: project.repo.name, brigade: brigade.slug}, function (err, foundProject) {
                if (err) console.error(err)
                if (!foundProject.length) {
                  console.log('creating', project.repo.name)
                  var projectData = createUpdateProjectData(project, {}, brigade)
                  var newProject = new Projects(projectData)
                  newProject.save(function (err) {
                    if (err) console.error(err)
                    resolve()
                  })
                } else { // project already exists, needs updating
                  console.log('updating', project.repo.name)
                  var thisProject = foundProject[0]
                  thisProject = createUpdateProjectData(project, thisProject, brigade)
                  thisProject.save(function (err) {
                    if (err) console.error(err)
                    resolve()
                  })
                }
              })
            })
          }
          mongooseActions.push(buildPromise(project))
        // search for previous schema
        })
        return Promise.all(mongooseActions)
          .then(function () {
            cb(null, results)
          })
          .catch(function (err) {
            throw err
          })
      })
      .catch(function (err) {
        console.error(err)
        cb(err)
      })
  })
}

projectsSchema.statics.publishToGithub = function (cb) {
  cb(null, 'isMatch')
}

module.exports = mongoose.model('Projects', projectsSchema)

function getRepos (url, aggregate, user, callback) {
  var headers = _.cloneDeep(defaultHeaders)
  headers['Authorization'] += user.tokens[0].accessToken
  var options = {
    url: url,
    headers: headers
  }
  request(options, function (err, response, body) {
    if (err) return callback(err, aggregate)
    if (!err && response.statusCode === 200) {
      var parsed = JSON.parse(body)
      aggregate = aggregate.concat(parsed)
      aggregate = _.uniq(aggregate)
      console.log('aggregate count', aggregate.length)
      // if there's a next link in header, call that recursively
      var linkHeader = linkHeaderParser(response.headers.link)
      if (linkHeader.next) {
        return getRepos(linkHeader.next.url, aggregate, user, callback)
      }
      return callback(null, aggregate)
    }
    callback({msg: 'Status Code not 200', response: response, body: body}, aggregate)
  })
}
function getRepoCivicJson (url, user, callback) {
  var headers = _.cloneDeep(defaultHeaders)
  headers['Authorization'] += user.tokens[0].accessToken
  var options = {
    url: url,
    headers: headers
  }
  request(options, function (err, response, body) {
    if (err) return callback(err)
    if (!err && response.statusCode === 200) {
      var civicJS
      try {
        var parsed = JSON.parse(body)
        var cj = new Buffer(parsed.content, 'base64')
        var civicJSON = cj.toString()
        civicJS = JSON.parse(civicJSON)
        console.log('civicJSON', civicJS)
      } catch (e) {
        console.warn('Error occured', e)
      }
      return callback(null, civicJS)
    }
    callback({msg: 'Status Code not 200', response: response, body: body})
  })
}
function createUpdateProjectData (project, original, brigade) {
  original = original || {}
  project.json = project.json || {}
  project.json.needs = project.json.needs || []
  project.json.categories = project.json.categories || []
  project.json.partners = project.json.partners || []
  project.json.data = project.json.data || []
  project.json.keywords = project.json.keywords || []
  project.json.tags = project.json.tags || []
  project.json.links = project.json.links || []
  project.json.contact = project.json.contact || {}

  original.id = project.repo.name // this is the slug - civic.sf.json + civic.dc.json
  original.brigade = brigade.slug // this is the slug - civic.sf.json + civic.dc.json
  original.status = project.json.status ? project.json.status.toLowerCase() : 'proposed' // civic.json + civic.dc.json - proposed, ideation, alpha, beta, production, archival

  original.thumbnailUrl = project.json.thumbnailUrl || 'https://placeholdit.imgix.net/~text?txtsize=15&txt=thumbnail&w=100&h=100'
  original.bornAt = project.json.bornAt || brigade.name
  original.geography = project.json.geography || brigade.location.general
  original.politicalEntity = project.json.politicalEntity || ''
  original.type = project.json.type || ''
  original.needs = original.needs || []
  original.needs = original.needs.concat(project.json.needs)
  original.needs = _.uniq(original.needs)
  original.categories = original.categories || []
  original.categories = original.categories.concat(project.json.categories)
  original.categories = _.uniq(original.categories)
  original.name = project.json.name || project.repo.name // Display titl
  original.description = project.json.description || project.repo.description || 'A new project.'
  original.license = project.json.license || 'MIT'
  original.homepage = project.json.homepage || project.repo.homepage || project.repo.url
  original.repository = project.json.repository || project.repo.url
  original.geography = original.geography || []
  original.geography = original.geography.concat(project.json.geography)
  original.geography = _.uniq(original.geography)
  original.contact = original.contact || {}
  original.contact.name = project.json.contact.name || project.repo.owner.login || 'unknown'
  original.contact.email = project.json.contact.email || 'unknown'
  original.partners = original.partners || []
  original.partners = original.partners.concat(project.json.partners)
  original.partners = _.uniq(original.partners)
  original.data = original.data || []
  original.data = original.data.concat(project.json.data)
  original.data = _.uniq(original.data)
  original.keywords = original.keywords || []
  original.keywords = original.keywords.concat(project.json.keywords)
  original.keywords = original.keywords.concat(project.json.tags)
  original.keywords = _.uniq(original.keywords)
  original.links = original.links || []
  original.links = original.links.concat(project.json.links)
  original.links = _.uniq(original.links)
  return original
}
