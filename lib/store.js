//
// Copyright 2019 Perforce Software
//
const { newCache } = require('transitory')

//
// Using transitory as the in-memory key/value store. Could have used
// github:isaacs/node-lru-cache but that lacks fine cache control, while
// github:aholstenson/transitory is a bit more sophisticated.
//
// Other obvious alternatives would be disk-based LSM trees, such as LevelDB
// which has a simple API, or RocksDB which offers additional features. Both
// of those are overkill for our needs at this time.
//

// Set up an in-memory cache of the user details.
const users = newCache()
  .expireAfterWrite(60 * 60 * 1000)
  .expireAfterRead(5 * 60 * 1000)
  .build()
setInterval(() => users.cleanUp(), 5 * 60 * 1000)

// Set up an in-memory database of pending login requests. The key is a unique
// request identifier, and the value is an object with an 'id' property, the
// value provided by the client in the /requests/new call. The object may
// contain additional properties.
const requests = newCache()
  .expireAfterWrite(10 * 60 * 1000)
  .expireAfterRead(5 * 60 * 1000)
  .build()
setInterval(() => requests.cleanUp(), 5 * 60 * 1000)

module.exports = {
  users,
  requests
}
