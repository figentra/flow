import { Config, Packages, WrittenConfig } from "@changesets/types";
//#region src/parse.d.ts
type ParseResult = {
  config: Config;
  warnings: string[];
  errors: undefined;
} | {
  config: undefined;
  warnings: string[];
  errors: string[];
};
export declare function validateConfig(json: unknown, packages: Packages): ParseResult;
export declare function readConfig(cwd?: string, packages?: Packages): Promise<ParseResult>;
//#endregion
//#region src/defaults.d.ts
export declare const defaultWrittenConfig: WrittenConfig;
export declare const defaultConfig: Config;
//#endregion