const store = new Map()
const logins = new Map()
const uuid = require('uuid/v4')

class Account {
  constructor (id) {
    this.accountId = id || uuid()
  }

  /**
   * @param use - can either be "id_token" or "userinfo", depending on
   *   where the specific claims are intended to be put in.
   * @param scope - the intended scope, while oidc-provider will mask
   *   claims depending on the scope automatically you might want to skip
   *   loading some claims from external resources etc. based on this detail
   *   or not return them in id tokens but only userinfo and so on.
   */
  async claims (use, scope) {
    return {
      sub: this.accountId, // it is essential to always return a sub claim

      address: {
        country: '000',
        formatted: '000',
        locality: '000',
        postal_code: '000',
        region: '000',
        street_address: '000'
      },
      birthdate: '1987-10-16',
      email: 'johndoe@example.com',
      email_verified: false,
      family_name: 'Doe',
      gender: 'male',
      given_name: 'John',
      locale: 'en-US',
      middle_name: 'Middle',
      name: 'John Doe',
      nickname: 'Johnny',
      phone_number: '+49 000 000000',
      phone_number_verified: false,
      picture: 'http://lorempixel.com/160/160/',
      preferred_username: 'Jdawg',
      profile: 'https://john.example.com',
      updated_at: 1454704946,
      website: 'http://example.com',
      zoneinfo: 'Europe/Berlin'
    }
  }

  static async findByLogin (login) {
    if (!logins.get(login)) {
      logins.set(login, new Account())
    }

    return logins.get(login)
  }

  static async findById (ctx, id, token) {
    // token is a reference to the token used for which a given account is being loaded,
    //   it is undefined in scenarios where account claims are returned from authorization endpoint
    // ctx is the koa request context
    if (!store.get(id)) {
      const acct = new Account(id)
      store.set(acct.accountId, acct)
    }
    return store.get(id)
  }
}

module.exports = Account