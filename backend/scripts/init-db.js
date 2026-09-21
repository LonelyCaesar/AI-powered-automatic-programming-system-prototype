const { initializePostgresSchema, postgresHealth } = require('../src/db/postgres')

initializePostgresSchema()
  .then(() => postgresHealth())
  .then(health => {
    console.log(JSON.stringify(health, null, 2))
    process.exit(health.ok ? 0 : 1)
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
