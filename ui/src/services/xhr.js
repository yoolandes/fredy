/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Global error handler - will be set by App.jsx
let globalErrorHandler = null;

export function setGlobalErrorHandler(handler) {
  globalErrorHandler = handler;
}

/**
 * post something to our backend.
 *
 * @param url
 * @param data based on the content type, you need to make sure to parse in the proper data
 * @param contentType default is json
 * @returns {Promise}
 */
export function xhrPost(url, data, contentType = 'application/json; charset=utf-8', isJson = true) {
  return executePostOrPutCall(url, contentType, data, isJson, true);
}
/**
 * put request to backend.
 *
 * @param url
 * @param data based on the content type, you need to make sure to parse in the proper data
 * @param contentType default is json
 * @returns {Promise}
 */
export function xhrPut(url, data, contentType = 'application/json; charset=utf-8', isJson = true) {
  return executePostOrPutCall(url, contentType, data, isJson, false);
}
function executePostOrPutCall(url, contentType, data, isJson, isPost) {
  return new Promise((resolve, reject) => {
    fetch(url, {
      method: isPost ? 'POST' : 'PUT',
      cache: 'no-cache',
      credentials: 'include',
      mode: 'cors',
      headers: {
        'Content-Type': contentType,
      },
      body: data == null ? JSON.stringify({}) : JSON.stringify(data),
    })
      .then((response) => (isJson ? parseJSON(response) : response))
      .then((response) => resolve(response))
      .catch((error) => {
        // Network error (server down, no connection, etc.)
        if (error instanceof TypeError || !error.status) {
          const errorObj = {
            status: 0,
            json: { errors: ['Server is unreachable. Please check if the backend is running.'] },
          };
          if (globalErrorHandler) {
            globalErrorHandler(errorObj.json.errors[0]);
          }
          reject(errorObj);
        } else {
          reject(error);
        }
      });
  });
}
/**
 * get request to backend
 * returns a Promise with
 * {
 *     status: statusCode,
 *     json: values
 * }
 *
 * if an error occurs, the promise rejects with
 * {
 *     json: errors: ['error', 'error']
 * }
 * @param url
 * @param contentType
 * @param isJson
 * @returns {Promise}
 */
export function xhrGet(url, contentType = 'application/json; charset=utf-8', isJson = true) {
  return new Promise((resolve, reject) => {
    fetch(url, {
      credentials: 'include',
      mode: 'cors',
      headers: {
        'Content-Type': contentType,
      },
    })
      .then((response) => (isJson ? parseJSON(response) : response))
      .then((response) => resolve(response))
      .catch((error) => {
        // Network error (server down, no connection, etc.)
        if (error instanceof TypeError || !error.status) {
          const errorObj = {
            status: 0,
            json: { errors: ['Server is unreachable. Please check if the backend is running.'] },
          };
          if (globalErrorHandler) {
            globalErrorHandler(errorObj.json.errors[0]);
          }
          reject(errorObj);
        } else {
          reject(error);
        }
      });
  });
}
/**
 * delete request to backend
 * returns a Promise with
 * {
 *     status: statusCode,
 *     json: values
 * }
 *
 * if an error occurs, the promise rejects with
 * {
 *     json: errors: ['error', 'error']
 * }
 * @param url
 * @param data
 * @returns {Promise}
 */
export function xhrDelete(url, data, contentType = 'application/json; charset=utf-8') {
  return new Promise((resolve, reject) => {
    fetch(url, {
      method: 'DELETE',
      credentials: 'include',
      mode: 'cors',
      body: data == null ? JSON.stringify({}) : JSON.stringify(data),
      headers: {
        'Content-Type': contentType,
      },
    })
      .then((response) => parseJSON(response))
      .then((response) => resolve(response))
      .catch((error) => {
        if (error.json != null && error.json.message != null) {
          reject(error.json.message);
        } else {
          reject({ errors: [`Unspecified Network error`] });
        }
      });
  });
}
function parseJSON(response) {
  return new Promise((resolve, reject) =>
    response
      .text()
      .then((text) => {
        //some responses doesn't contain a body. .json() would throw errors here...
        const json = text != null && text.length > 0 ? JSON.parse(text) : {};
        if (response.ok) {
          resolve({
            status: response.status,
            json,
          });
        } else {
          // Handle session expiration - redirect to login
          if (response.status === 401 && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          // Handle server errors (502, 503, etc.)
          if (response.status >= 502 && response.status <= 504) {
            const errorObj = {
              status: response.status,
              json: { errors: ['Server is temporarily unavailable. Please try again later.'] },
            };
            if (globalErrorHandler) {
              globalErrorHandler(errorObj.json.errors[0]);
            }
            reject(errorObj);
            return;
          }
          reject({
            status: response.status,
            json,
          });
        }
      })
      .catch((error) => reject('Error while trying to parse json.', error)),
  );
}
