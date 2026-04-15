const { createConfig } = require('./src/config');
const { createServerApplication } = require('./src/app');

const serverApplication = createServerApplication(createConfig());

module.exports = serverApplication;

if (require.main === module) {
  serverApplication.startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
