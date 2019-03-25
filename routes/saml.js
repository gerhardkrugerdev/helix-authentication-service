//
// Copyright 2019 Perforce Software
//
const fs = require('fs')
const express = require('express')
const router = express.Router()
const passport = require('passport')
const { Strategy } = require('passport-saml')
const samlp = require('samlp')
const { users, requests } = require('../store')

const idpOptions = {
  cert: process.env.IDP_CERT_FILE ? fs.readFileSync(process.env.IDP_CERT_FILE) : undefined,
  key: process.env.IDP_KEY_FILE ? fs.readFileSync(process.env.IDP_KEY_FILE) : undefined,
  getPostURL: (audience, authnRequestDom, req, callback) => {
    return callback(null, (req.authnRequest && req.authnRequest.acsUrl)
      ? req.authnRequest.acsUrl
      : process.env.SP_ACS_URL)
  },
  issuer: 'urn:auth-service:idp',
  redirectEndpointPath: '/saml/login',
  postEndpointPath: '/saml/login',
  logoutEndpointPaths: {
    'redirect': '/saml/logout'
  }
}

const samlOptions = {
  callbackUrl: process.env.SVC_BASE_URI + '/saml/sso',
  logoutCallbackUrl: process.env.SVC_BASE_URI + '/saml/slo',
  entryPoint: process.env.SAML_IDP_SSO_URL,
  logoutUrl: process.env.SAML_IDP_SLO_URL,
  issuer: process.env.SAML_SP_ISSUER || 'urn:example:sp',
  audience: process.env.SP_AUDIENCE || undefined,
  privateCert: process.env.SP_KEY_FILE ? fs.readFileSync(process.env.SP_KEY_FILE) : undefined,
  signatureAlgorithm: process.env.SP_KEY_ALGO || 'sha256'
}
const strategy = new Strategy(samlOptions, (profile, done) => {
  // profile: {
  //   issuer: {...},
  //   sessionIndex: '_1189d45be2aed1519794',
  //   nameID: 'jackson@example.com',
  //   nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  //   nameQualifier: undefined,
  //   spNameQualifier: undefined,
  //   fullname: 'Sam L. Jackson',
  //   getAssertionXml: [Function]
  // }
  //
  // produce a "user" object that contains the information that passport-saml
  // requires for logging out via SAML
  //
  return done(null, {
    nameID: profile.nameID,
    nameIDFormat: profile.nameIDFormat,
    sessionIndex: profile.sessionIndex
  })
})
passport.use(strategy)
router.use(passport.initialize())
router.use(passport.session())

passport.serializeUser((user, done) => {
  // serialize the entire object as-is
  done(null, user)
})

passport.deserializeUser((user, done) => {
  done(null, user)
})

router.get('/metadata', (req, res) => {
  let xml = strategy.generateServiceProviderMetadata()
  res.header('Content-Type', 'text/xml').send(xml)
})

router.get('/idp/metadata', samlp.metadata(idpOptions))

router.get('/login/:id', (req, res, next) => {
  // save the request identifier for request/user mapping
  req.session.requestId = req.params.id
  next()
}, passport.authenticate('saml', {
  failureRedirect: '/saml/login_failed'
}))

router.get('/login', (req, res, next) => {
  // Backward-compatible API for legacy SAML behavior, in which the request does
  // not have a user identifier associated with a request identifier.
  samlp.parseRequest(req, (err, data) => {
    if (err) {
      res.render('error', {
        message: 'SAML AuthnRequest parse error: ' + err.message,
        error: err
      })
    } else if (data) {
      // parsed data: { issuer: 'urn:example:sp',
      //   assertionConsumerServiceURL: 'http://192.168.1.106/login',
      //   destination: 'https://192.168.1.66:3000/saml/login',
      //   id: 'ONELOGIN_de5494ef71c18d9f0bf602619c730752c2822adc',
      //   requestedAuthnContext:
      //    { authnContextClassRef:
      //       'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport' } }
      req.session.authnRequest = {
        relayState: req.query.RelayState,
        id: data.id,
        issuer: data.issuer,
        destination: data.destination,
        acsUrl: data.assertionConsumerServiceURL,
        forceAuthn: data.forceAuthn === 'true',
        context: data.requestedAuthnContext
      }
      requests.set(data.id, 'SAML:legacy:placeholder')
      // now that everything is set up, go through the normal login path
      res.redirect('login/' + data.id)
    }
  })
})

router.post('/sso', passport.authenticate('saml', {
  successRedirect: '/saml/success',
  failureRedirect: '/saml/login_failed'
}))

router.get('/login_failed', (req, res, next) => {
  // we need a route that is not the login route lest we end up
  // in a redirect loop when a failure occurs
  res.render('login_failed')
})

function checkAuthentication (req, res, next) {
  if (req.isAuthenticated()) {
    next()
  } else {
    res.redirect('/')
  }
}

router.get('/success', checkAuthentication, (req, res, next) => {
  const userId = requests.get(req.session.requestId)
  if (userId === 'SAML:legacy:placeholder') {
    // This is a SAML legacy hack, in which the best we can do is to assume that
    // the nameID is the user identifier expected by the login extensions.
    users.set(req.user.nameID, req.user)
    // Generate a new SAML response befitting of the request we received.
    const moreOptions = Object.assign({}, idpOptions, {
      lifetimeInSeconds: 3600,
      audiences: req.session.authnRequest.issuer,
      recipient: req.session.authnRequest.acsUrl,
      inResponseTo: req.session.authnRequest.id,
      authnContextClassRef: req.session.authnRequest.context.authnContextClassRef,
      sessionIndex: undefined,
      includeAttributeNameFormat: true
    })
    // make a user object that samlp will work with
    const user = Object.assign({}, req.user, {
      id: req.user.nameID,
      emails: [ null ],
      displayName: '',
      name: {
        givenName: '',
        familyName: ''
      }
    })
    samlp.getSamlResponse(moreOptions, user, (err, resp) => {
      if (err) {
        console.error(err)
        next()
      } else {
        // render an HTML form to send the response back to the SP
        res.render('samlresponse', {
          AcsUrl: req.session.authnRequest.acsUrl,
          SAMLResponse: Buffer.from(resp, 'utf8').toString('base64'),
          RelayState: req.session.authnRequest.relayState
        })
      }
    })
  } else {
    // "normal" success path, save user data for verification
    users.set(userId, req.user)
    const name = req.user.nameID
    res.render('details', { name })
  }
})

// Legacy route in which extensions receive a SAML response from the client and
// need it to be properly validated, which is hard to do without XML parsing.
router.post('/validate', (req, res, next) => {
  strategy._saml.validatePostResponse(req.body, (err, profile, loggedOut) => {
    if (err) {
      res.status(400).send(`error: ${err}`)
    } else if (loggedOut) {
      res.status(400).send('error: logged out?')
    } else {
      res.json(profile)
    }
  })
})

router.get('/logout', passport.authenticate('saml', {
  samlFallback: 'logout-request'
}))

function handleSLO (req, res) {
  req.session.destroy()
  res.redirect('/')
}

// some services use GET and some use POST
router.get('/slo', passport.authenticate('saml', { samlFallback: 'logout-request' }), handleSLO)
router.post('/slo', passport.authenticate('saml', { samlFallback: 'logout-request' }), handleSLO)

module.exports = router
