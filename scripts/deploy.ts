import { Deployer } from './deployer';

async function main(): Promise<void> {
  const deployer = new Deployer();
  await deployer.init(process.env.EXALOTTO_OWNER);
  await deployer.deployAll();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
