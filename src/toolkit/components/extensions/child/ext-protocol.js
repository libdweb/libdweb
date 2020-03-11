/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow strict
/* eslint spaced-comment: ["error", "always", { "markers": ["::", ":"], "exceptions":[":"] }] */
"use strict"

/*::
import { Cu, Cr, ExtensionAPI, BaseContext } from "gecko";
import type { nsIMessageSender, nsresult } from "gecko";
import type { HandlerInbox, HandlerOutboxMessage, Port, ReadyState, HandlerOutbox, Inn, Out, Handler } from "../interface/protocol.js";
*/

{
  // TextEncoder is not available without importing it.
  /* eslint-disable-next-line mozilla/reject-importGlobalProperties */
  Cu.importGlobalProperties(["TextEncoder"])
  /*:: import { ProtocolUtil } from "../ProtocolUtil.jsm"*/
  // ChromeUtils.defineModuleGetter(
  //   this,
  //   "ProtocolUtil",
  //   "resource://gre/modules/ProtocolUtil.jsm"
  // );

  /*:: const { XPCOMUtils } =*/
  ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm")

  const OUTBOX = "libdweb:protocol:responder:outbox"
  const INBOX = "libdweb:protocol:responder:inbox"

  const IDLE = 0
  const ACTIVE = 1
  const PAUSED = 2
  const CANCELED = 3
  const CLOSED = 4
  const FAILED = 5

  const encoder = new TextEncoder()

  class RequestBodySource {
    /*::
    id:string;
    messageManager:Out<HandlerOutbox>;
    controller:ReadableStreamController
    type: string
    start: ReadableStreamController => ?Promise<void>
    pull: ReadableStreamController => ?Promise<void>
    cancel: string => ?Promise<void>
    */
    constructor(id /*: string*/, messageManager /*: Out<HandlerOutbox>*/) {
      this.id = id
      // this.type = "bytes"
      this.messageManager = messageManager
    }
    start(controller) {
      this.controller = controller
    }
    pull() {
      const { id, messageManager } = this
      messageManager.sendAsyncMessage(OUTBOX, {
        type: "resume-request-stream",
        id
      })
    }
    cancel(reason) {
      const { id, messageManager } = this
      messageManager.sendAsyncMessage(OUTBOX, {
        type: "cancel-request-stream",
        id,
        reason: String(reason)
      })
    }

    suspend() {
      const { id, messageManager } = this
      messageManager.sendAsyncMessage(OUTBOX, {
        type: "suspend-request-stream",
        id
      })
    }
    onWrite(buffer) {
      const { controller } = this

      if (controller) {
        Reflect.apply(controller.enqueue, controller, [
          Cu.cloneInto(new Uint8Array(buffer), controller)
        ])
        if (controller.desiredSize <= 0) {
          this.suspend()
        }
      }
    }
    onClose() {
      const { controller } = this
      if (controller) {
        controller.close()
      }
    }
    onError(message) {
      const { controller } = this

      if (controller) {
        controller.error(new Error(message))
      }
    }
  }

  // Polyfills Request instance such that it corresponds to the instances passed
  // to a service workers - has methods to consume body for POST / PUT style
  // requests.
  const polyfillRequest = (request, response) => {
    Reflect.defineProperty(request, "bodyUsed", {
      get() {
        return response.bodyUsed
      }
    })
    Reflect.defineProperty(request, "body", {
      get() {
        return response.body
      }
    })
    Reflect.defineProperty(request, "arrayBuffer", {
      value() {
        return response.arrayBuffer()
      }
    })
    Reflect.defineProperty(request, "blob", {
      value() {
        return response.blob()
      }
    })

    Reflect.defineProperty(request, "formData", {
      value() {
        return response.formData()
      }
    })

    Reflect.defineProperty(request, "formData", {
      value() {
        return response.formData()
      }
    })

    Reflect.defineProperty(request, "json", {
      value() {
        return response.json()
      }
    })

    Reflect.defineProperty(request, "text", {
      value() {
        return response.text()
      }
    })

    Reflect.defineProperty(request, "close", {
      value() {
        return polyfillRequest(request.clone(), response.clone())
      }
    })

    return request
  }

  // Creates `Request` instance that is API equivalent to the one passed to the
  // service workers. Which requires some polyfilling as right now there is no
  // API that allows creating request instances that have a body.
  const createProtocolRequest = (scope, url, source, options) => {
    const request = Cu.waiveXrays(
      Reflect.construct(scope.Request, [url, options])
    )

    if (source) {
      const stream = Reflect.construct(scope.ReadableStream, [
        Cu.cloneInto(
          {
            start(controller) {
              source.start(Cu.waiveXrays(controller))
            },
            pull(controller) {
              source.pull(Cu.waiveXrays(controller))
            },
            cancel(reason) {
              source.cancel(reason)
            }
          },
          scope,
          { cloneFunctions: true }
        )
      ])
      const response = Reflect.construct(scope.Response, [stream])
      polyfillRequest(request, response)
    }

    return request
  }

  class ProtocolRequest {
    /*::
    id:string;
    port:Port<HandlerOutboxMessage>;
    response:Promise<Response>;
    statusText:string;
    ok:boolean;
    headers:{[string]:string};
    reader:?ReadableStreamReader;
    readyState:ReadyState;
    body:?RequestBodySource;
    */
    constructor(
      id /*: string*/,
      port /*: Port<HandlerOutboxMessage>*/,
      response /*: Promise<Response>*/,
      body /*: ?RequestBodySource*/
    ) {
      this.id = id
      this.port = port
      this.response = response
      this.reader = null
      this.readyState = IDLE
      this.body = body
    }

    // Following methods correspond to methods on nsIRequest and are
    // invoked whenever corresponding methods on nsIRequest are called.
    suspend() {
      switch (this.readyState) {
        case ACTIVE: {
          this.readyState = PAUSED
          return undefined
        }
      }
    }
    resume() {
      switch (this.readyState) {
        case IDLE:
          return this.start()
        case PAUSED:
          return this.activate()
      }
    }
    cancel(status /*: nsresult*/ = Cr.NS_OK) {
      this.readyState = CANCELED
      const { reader } = this
      if (reader) {
        reader.cancel(status === 0 ? "" : String(status))
        reader.releaseLock()
      }
    }

    // Following methods correspond to the methods of the
    // ReadableStreamDefaultController. When this request is active
    // it reads data from `response.body` and invokes methods below as necessary.
    enqueue(buffer) {
      const { id, port } = this
      port.send({
        type: "write-response-stream",
        id,
        buffer
      })
    }
    error(error) {
      switch (this.readyState) {
        case ACTIVE:
        case PAUSED: {
          this.readyState = FAILED
          const { reader, id } = this
          if (reader) {
            reader.releaseLock()
          }
          return this.port.send({
            type: "error-response-stream",
            id,
            message: error.message
          })
        }
      }
    }
    close() {
      switch (this.readyState) {
        case ACTIVE:
        case PAUSED: {
          this.readyState = CLOSED
          const { reader, id } = this
          if (reader) {
            reader.releaseLock()
            this.reader = null
          }

          this.port.send({
            type: "close-response-stream",
            id,
            reason: null
          })
        }
      }
    }

    async activate() {
      // While request is active will keep reading data from
      // response.body and sending it to the corresponding
      // agent.
      this.readyState = ACTIVE
      while (this.readyState === ACTIVE) {
        if (this.reader) {
          try {
            const { done, value } = await this.reader.read()

            if (value) {
              const { buffer } =
                typeof value === "string" ? encoder.encode(value) : value
              this.enqueue(buffer)
            }

            // If all the data has being read close response.
            if (done) {
              this.close()
            }
          } catch (error) {
            this.error(error)
          }
        } else {
          // If there response.body is empty close response.
          this.close()
        }
      }
    }

    async start() {
      if (this.readyState === IDLE) {
        this.readyState = ACTIVE
        const { response, id } = this
        console.log("xxx", await response)
        const { status, statusText, ok, headers, body } = Cu.waiveXrays(
          await response
        )

        this.port.send({
          type: "start-response",
          id,
          status,
          statusText,
          ok,
          // @FlowIgnore
          headers: Object.fromEntries(headers)
        })

        if (body) {
          this.reader = body.getReader()
        }
        this.activate()
      }
    }

    onWrite(buffer) {
      const { body } = this
      if (body) {
        body.onWrite(buffer)
      }
    }
    onClose() {
      const { body } = this
      if (body) {
        body.onClose()
      }
    }
    onError(message) {
      const { body } = this
      if (body) {
        body.onError(message)
      }
    }
  }

  // ProtocolResponder manages protocol handlers registered by a web extension.
  // Registration is communicated with a ProtocolService, which will forward
  // messages for the corresponding requests. On every new request
  // `ProtocolResponder` creates a web standard `Request` instance and
  // calls a registered handler with it. Returned web standard `Response` is
  // then translated to messages that it sends back to the `ProtocolService`.
  // Note that web standard `Request` / `Response` instances abstract a lot of
  // complexity associated with asynchronousy streaming body consumbtion that
  // can be suspended, resumed or cancelled and `ProtocolResponder` manages
  // that by translating stream API calls and events into messages and back.
  class ProtocolResponder {
    /*::
    context: BaseContext;
    protocolHandlers: { [string]: Handler };
    requests: {[string]: ProtocolRequest};
    isActive:boolean;
    */
    constructor(context /*: BaseContext */) {
      this.context = context
      this.protocolHandlers = {}
      this.requests = {}
      this.isActive = false
    }
    receiveMessage({ name, data, target } /*: HandlerInbox */) {
      switch (data.type) {
        case "start-request": {
          return void this.onStartRequest(data, target)
        }
        case "suspend-request": {
          return void this.onSuspendRequest(data)
        }
        case "resume-request": {
          return void this.onResumeRequest(data)
        }
        case "cancel-request": {
          return void this.onCancelRequest(data)
        }
        case "write-request-stream": {
          return void this.onWriteRequestStream(data)
        }
        case "close-request-stream": {
          return void this.onCloseRequestStream(data)
        }
        case "error-request-stream": {
          return void this.onErrorRequestStream(data)
        }
      }
    }
    register(scheme /*: string */, protocolHandler /*: Handler */) {
      this.activate()
      const registeredHandler = this.protocolHandlers[scheme]
      if (registeredHandler != null && registeredHandler !== protocolHandler) {
        throw new ExtensionUtils.ExtensionError(
          `Protocol ${scheme}:// already already has a handler`
        )
      }
      this.protocolHandlers[scheme] = protocolHandler
      return this.context.childManager.callParentAsyncFunction(
        "protocol.register",
        [
          {
            type: "register",
            scheme,
            id: this.context.extension.id
          }
        ]
      )
    }
    unregister(scheme /*: string*/) {
      const protocolHandler = this.protocolHandlers[scheme]
      if (protocolHandler != null) {
        delete this.protocolHandlers[scheme]
        return this.context.childManager.callParentAsyncFunction(
          "protocol.unregister",
          [
            {
              type: "unregister",
              scheme,
              id: this.context.extension.id
            }
          ]
        )
      }
    }
    async onStartRequest(data, messageManager /*: Out<HandlerOutbox> */) {
      const {
        id,
        scheme,
        contentLength,
        url,
        method,
        headers,
        credentials,
        cache,
        redirect,
        referrer,
        integrity
      } = data
      const source =
        contentLength === 0 ? null : new RequestBodySource(id, messageManager)

      const request = createProtocolRequest(
        this.context.cloneScope,
        url,
        source,
        {
          method,
          headers,
          credentials,
          cache,
          redirect,
          referrer,
          integrity
        }
      )

      const response = new ProtocolRequest(
        id,
        this,
        this.handleRequest(scheme, request),
        source
      )

      this.requests[id] = response
      response.resume()
    }
    async handleRequest(scheme, request) {
      try {
        const event = Cu.cloneInto({}, this.context.cloneScope)
        Reflect.defineProperty(event, "request", {
          value: { url: request.url }
        })
        const { response } = await this.protocolHandlers[scheme].raw(event)
        return response
      } catch (error) {
        return new this.context.cloneScope.Response(error, {
          ok: false,
          status: 500,
          statusText: "Extension failure"
        })
      }
    }
    send(message) {
      this.context.childManager.messageManager.sendAsyncMessage(OUTBOX, message)
    }
    onSuspendRequest(data) {
      const request = this.requests[data.id]
      request.suspend()
    }
    onResumeRequest(data) {
      const request = this.requests[data.id]
      request.resume()
    }
    onCancelRequest(data) {
      const request = this.requests[data.id]
      request.cancel()
    }
    onWriteRequestStream(data) {
      const request = this.requests[data.id]
      request.onWrite(data.buffer)
    }
    onCloseRequestStream(data) {
      const request = this.requests[data.id]
      request.onClose()
    }
    onErrorRequestStream(data) {
      const request = this.requests[data.id]

      request.onError(data.message)
    }

    activate() {
      if (!this.isActive) {
        this.isActive = true
        this.context.messageManager.addMessageListener(INBOX, this)
      }
    }
    // Called on close. Cancels all the pending requests and unregisters
    // all the protocol handlers.
    terminate() {
      const { protocolHandlers, requests } = this
      for (const id of Object.keys(requests)) {
        const request = requests[id]
        request.cancel()
        delete requests[id]
      }

      for (const scheme of Object.keys(protocolHandlers)) {
        delete protocolHandlers[scheme]
        this.unregister(scheme)
      }
      this.context.messageManager.removeMessageListener(INBOX, this)
      this.isActive = false
    }
  }

  // @FlowIgnore Flow does not know what `this` is here.
  this.protocol = class extends ExtensionAPI /*:: <ProtocolResponder>*/ {
    /*::
    protocolResponder:?ProtocolResponder
    */
    getAPI(context) {
      const protocolResponder = new ProtocolResponder(context)
      context.callOnClose({ close: () => protocolResponder.terminate() })

      return {
        protocol: {
          onRequest: new ExtensionCommon.EventManager({
            context,
            name: `protocol.onFetch`,
            register: (fire, scheme) => {
              // ProtocolUtil.ensurePermission(this.extension, scheme);
              protocolResponder.register(scheme, fire)
              return () => protocolResponder.unregister(scheme)
            }
          }).api()
        }
      }
    }
  }
}
