import { ConfigLiteral, makeErrUrl, Response } from ".";
import { Paginator } from "../paginator";
import { defaults } from "../defaults";

import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

export interface Options {
  attempts?: number;
  paginated?: boolean;
}

export interface ConfigObject extends Options {
  request: ConfigLiteral;
}

export interface ConfigExact extends ConfigObject {
  paginated?: false;
}

export interface OptionsExact extends Options {
  paginated?: false;
}

export interface ConfigPaginated extends ConfigObject {
  paginated: true;
}

export interface OptionsPaginated extends Options {
  paginated: true;
}

export interface ConfigBoth extends ConfigObject {
  paginated: boolean;
}

export interface OptionsBoth extends Options {
  paginated: boolean;
}

// Internal functions. interfaces, type definitions and constants.

function isConfigObject(obj: unknown | undefined): obj is ConfigObject {
  return typeof obj === "object" && obj !== null && "request" in obj;
}

/**
 * Make a simple request and return a Response object.
 *
 * @param this the axios instance to use internally.
 * @param config the request payload.
 * @param opts the requests options for internal handling.
 * @returns the parsed Response from the clean request.
 */
export async function getResponse<T>(
  this: AxiosInstance,
  config: ConfigLiteral | ConfigObject,
  opts?: Options
): Promise<Response<T | Paginator<T>>> {
  const [reqConfig, reqOpts] = isConfigObject(config)
    ? [config.request, config]
    : [config, opts];

  const attempts = reqOpts?.attempts ?? defaults.attempts;
  const paginated = reqOpts?.paginated ?? false;

  const resOpts = await (async () => {
    for (let i = 0; i < attempts; i++) {
      try {
        const config = reqConfig as string & AxiosRequestConfig;
        const { data, request, status } = await this(config);

        return {
          payload: paginated ? new Paginator(data) : data,
          requestURL: request.responseURL,
          status: status,
        };
      } catch (e) {
        if (i + 1 === attempts && axios.isAxiosError(e)) {
          return {
            error: e.response?.data,
            requestURL: e.request?.responseURL || makeErrUrl(e),
            status: e.response?.status,
          };
        }
      }
    }

    return undefined;
  })();

  return Response.factory<T>(resOpts);
}
