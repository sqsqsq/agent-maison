import { __nonresidentDesignPublicationFaultWorker } from '../unit/design-authority-repair.unit.test';

void __nonresidentDesignPublicationFaultWorker(process.argv[2]).catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
