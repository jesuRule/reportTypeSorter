reportTypeSorter
================

This SFDX plugins helps you to sort fields alphabetically in a Report Type.

⚠ _Some standard fields are not sorted correctly due to an inconsistency in Salesforce API's. For example for Account.Type field, the UI label is `Type` but Salesforce API's provide `Account Type` instead, so it would be wrongly placed within the Report Type._

# Usage
<!-- toc -->

<!-- tocstop -->
<!-- install -->
<!-- usage -->
```sh-session
$ sfdx plugins:install report-type-sorter
$ sfdx COMMAND
running command...
$ sfdx (-v|--version|version)
report-type-sorter/0.0.0 win32-x64 node-v14.17.1
$ sfdx --help [COMMAND]
USAGE
  $ sfdx COMMAND
...
```
<!-- usagestop -->

# Commands
<!-- commands -->
* [`sfdx rt:order -r <string> [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-rtorder--r-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)

## `sfdx rt:order -r <string> [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

order fields within a report type

```
USAGE
  $ sfdx rt:order -r <string> [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -r, --reporttypename=reporttypename                                               (required) report type to apply
                                                                                    order to

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx rt:order --targetusername myOrg@example.com -r Service_Contracts_with_Entitlements
       Applying alphabetical order
       Deploying Report Type to alice@s4g.es with ID 0Af3X00000dpGJMSA2
       Deploying...
       Report Type Service_Contracts_with_Entitlements sorted
```

_See code: [src/commands/rt/order.ts](https://github.com/jesuRule/reportTypeSorter/blob/v0.0.0/src/commands/rt/order.ts)_
<!-- commandsstop -->
