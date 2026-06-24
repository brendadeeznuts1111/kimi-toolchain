# DemoConfig

Source: `test/fixtures/property-table-target.ts`

| Property   | Type                | Default | Required | Description                                    |  Min |   Max | Example                 | EnvVar       | DeprecatedIn |              LastModified | SourceFile                             |
| :--------- | :------------------ | :------ | :------- | :--------------------------------------------- | ---: | ----: | :---------------------- | :----------- | :----------- | ------------------------: | :------------------------------------- |
| apiUrl     | string              | —       | yes      | API base URL                                   |    — |     — | https://api.example.com | DEMO_API_URL | —            | 2026-06-19T13:43:26-05:00 | test/fixtures/property-table-target.ts |
| timeout    | number \| undefined | 30000   | no       | Request timeout in milliseconds                | 1000 | 60000 | —                       | —            | —            | 2026-06-19T13:43:26-05:00 | test/fixtures/property-table-target.ts |
| apiKey     | string \| undefined | —       | yes      | API secret (required even when optional in TS) |    — |     — | —                       | —            | —            | 2026-06-19T13:43:26-05:00 | test/fixtures/property-table-target.ts |
| legacyMode | boolean             | —       | yes      | —                                              |    — |     — | —                       | —            | 2.0.0        | 2026-06-19T13:43:26-05:00 | test/fixtures/property-table-target.ts |
