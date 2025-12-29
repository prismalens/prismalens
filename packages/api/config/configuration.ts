import { getConfig } from '@prismalens/config';

export default () => ({
  PORT: getConfig().PRISMALENS_SERVER_PORT || 5367,
  DATABASE_URL: getConfig().PRISMALENS_DB_URL,
});