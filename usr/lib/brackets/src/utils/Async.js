/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, window */

/**
 * Utilities for working with Deferred, Promise, and other asynchronous processes.
 */
define(function (require, exports, module) {
    "use strict";
    
    // Further ideas for Async utilities...
    //  - Utilities for blocking UI until a Promise completes?
    //  - A "SuperDeferred" could feature some very useful enhancements:
    //     - API for cancellation (non guaranteed, best attempt)
    //     - Easier way to add a timeout clause (withTimeout() wrapper below is more verbose)
    //     - Encapsulate the task kickoff code so you can start it later, e.g. superDeferred.start()
    //  - Deferred/Promise are unable to do anything akin to a 'finally' block. It'd be nice if we
    //    could harvest exceptions across all steps of an async process and pipe them to a handler,
    //    so that we don't leave UI-blocking overlays up forever, etc. But this is hard: we'd have
    //    wrap every async callback (including low-level native ones that don't use [Super]Deferred)
    //    to catch exceptions, and then understand which Deferred(s) the code *would* have resolved/
    //    rejected had it run to completion.
    

    /**
     * Executes a series of tasks in parallel, returning a "master" Promise that is resolved once
     * all the tasks have resolved. If one or more tasks fail, behavior depends on the failFast
     * flag:
     *   - If true, the master Promise is rejected as soon as the first task fails. The remaining
     *     tasks continue to completion in the background.
     *   - If false, the master Promise is rejected after all tasks have completed.
     *
     * If nothing fails:          (M = master promise; 1-4 = tasks; d = done; F = fail)
     *  M  ------------d
     *  1 >---d        .
     *  2 >------d     .
     *  3 >---------d  .
     *  4 >------------d
     *
     * With failFast = false:
     *  M  ------------F
     *  1 >---d     .  .
     *  2 >------d  .  .
     *  3 >---------F  .
     *  4 >------------d
     *
     * With failFast = true: -- equivalent to $.when()
     *  M  ---------F
     *  1 >---d     .
     *  2 >------d  .
     *  3 >---------F
     *  4 >------------d   (#4 continues even though master Promise has failed)
     * (Note: if tasks finish synchronously, the behavior is more like failFast=false because you
     * won't get a chance to respond to the master Promise until after all items have been processed)
     *
     * To perform task-specific work after an individual task completes, attach handlers to each
     * Promise before beginProcessItem() returns it.
     *
     * Note: don't use this if individual tasks (or their done/fail handlers) could ever show a user-
     * visible dialog: because they run in parallel, you could show multiple dialogs atop each other.
     *
     * @param {!Array.<*>} items
     * @param {!function(*, number):Promise} beginProcessItem
     * @param {!boolean} failFast
     * @return {$.Promise}
     */
    function doInParallel(items, beginProcessItem, failFast) {
        var promises = [];
        var masterDeferred = new $.Deferred();
        
        if (items.length === 0) {
            masterDeferred.resolve();
            
        } else {
            var numCompleted = 0;
            var hasFailed = false;
            
            items.forEach(function (item, i) {
                var itemPromise = beginProcessItem(item, i);
                promises.push(itemPromise);
                
                itemPromise.fail(function () {
                    if (failFast) {
                        masterDeferred.reject();
                    } else {
                        hasFailed = true;
                    }
                });
                itemPromise.always(function () {
                    numCompleted++;
                    if (numCompleted === items.length) {
                        if (hasFailed) {
                            masterDeferred.reject();
                        } else {
                            masterDeferred.resolve();
                        }
                    }
                });
            });
            
        }
        
        return masterDeferred.promise();
    }
    
    /**
     * Executes a series of tasks in serial (task N does not begin until task N-1 has completed).
     * Returns a "master" Promise that is resolved once all the tasks have resolved. If one or more
     * tasks fail, behavior depends on the failAndStopFast flag:
     *   - If true, the master Promise is rejected as soon as the first task fails. The remaining
     *     tasks are never started (the serial sequence is stopped).
     *   - If false, the master Promise is rejected after all tasks have completed.
     *
     * If nothing fails:
     *  M  ------------d
     *  1 >---d        .
     *  2     >--d     .
     *  3        >--d  .
     *  4           >--d
     *
     * With failAndStopFast = false:
     *  M  ------------F
     *  1 >---d     .  .
     *  2     >--d  .  .
     *  3        >--F  .
     *  4           >--d
     *
     * With failAndStopFast = true:
     *  M  ---------F
     *  1 >---d     .
     *  2     >--d  .
     *  3        >--F
     *  4          (#4 never runs)
     *
     * To perform task-specific work after an individual task completes, attach handlers to each
     * Promise before beginProcessItem() returns it.
     * 
     * @param {!Array.<*>} items
     * @param {!function(*, number):Promise} beginProcessItem
     * @param {!boolean} failAndStopFast
     * @return {$.Promise}
     */
    function doSequentially(items, beginProcessItem, failAndStopFast) {

        var masterDeferred = new $.Deferred(),
            hasFailed = false;
        
        function doItem(i) {
            if (i >= items.length) {
                if (hasFailed) {
                    masterDeferred.reject();
                } else {
                    masterDeferred.resolve();
                }
                return;
            }
            
            var itemPromise = beginProcessItem(items[i], i);
            
            itemPromise.done(function () {
                doItem(i + 1);
            });
            itemPromise.fail(function () {
                if (failAndStopFast) {
                    masterDeferred.reject();
                    // note: we do NOT process any further items in this case
                } else {
                    hasFailed = true;
                    doItem(i + 1);
                }
            });
        }
        
        doItem(0);
        
        return masterDeferred.promise();
    }
    
    /**
     * Executes a series of synchronous tasks sequentially spread over time-slices less than maxBlockingTime.
     * Processing yields by idleTime between time-slices.
     * 
     * @param {!Array.<*>} items
     * @param {!function(*, number)} fnProcessItem  Function that synchronously processes one item
     * @param {number=} maxBlockingTime
     * @param {number=} idleTime
     * @return {$.Promise}
     */
    function doSequentiallyInBackground(items, fnProcessItem, maxBlockingTime, idleTime) {
        
        maxBlockingTime = maxBlockingTime || 15;
        idleTime = idleTime || 30;
        
        var sliceStartTime = (new Date()).getTime();
        
        return doSequentially(items, function (item, i) {
            var result = new $.Deferred();
            
            // process the next item
            fnProcessItem(item, i);
            
            // if we've exhausted our maxBlockingTime
            if ((new Date()).getTime() - sliceStartTime >= maxBlockingTime) {
                //yield
                window.setTimeout(function () {
                    sliceStartTime = (new Date()).getTime();
                    result.resolve();
                }, idleTime);
            } else {
                //continue processing
                result.resolve();
            }

            return result;
        }, false);
    }
    
    
    /**
     * Executes a series of tasks in parallel, saving up error info from any that fail along the way.
     * Returns a Promise that is only resolved/rejected once all tasks are complete. This is
     * essentially a wrapper around doInParallel(..., false).
     *
     * If one or more tasks failed, the entire "master" promise is rejected at the end - with one
     * argument: an array objects, one per failed task. Each error object contains:
     *  - item -- the entry in items whose task failed
     *  - error -- the first argument passed to the fail() handler when the task failed
     *
     * @param {!Array.<*>} items
     * @param {!function(*, number):Promise} beginProcessItem
     * @return {$.Promise}
     */
    function doInParallel_aggregateErrors(items, beginProcessItem) {
        var errors = [];
        
        var masterDeferred = new $.Deferred();
        
        var parallelResult = doInParallel(
            items,
            function (item, i) {
                var itemResult = beginProcessItem(item, i);
                itemResult.fail(function (error) {
                    errors.push({ item: item, error: error });
                });
                return itemResult;
            },
            false
        );
        
        parallelResult
            .done(function () {
                masterDeferred.resolve();
            })
            .fail(function () {
                masterDeferred.reject(errors);
            });
        
        return masterDeferred.promise();
    }
    
    
    /** Value passed to fail() handlers that have been triggered due to withTimeout()'s timeout */
    var ERROR_TIMEOUT = {};
    
    /**
     * Adds timeout-driven failure to a Promise: returns a new Promise that is resolved/rejected when
     * the given original Promise is resolved/rejected, OR is rejected after the given delay - whichever
     * happens first.
     * 
     * If the original Promise is resolved/rejected first, done()/fail() handlers receive arguments
     * piped from the original Promise. If the timeout occurs first instead, fail() is called with the
     * token Async.ERROR_TIMEOUT.
     * 
     * @param {$.Promise} promise
     * @param {number} timeout
     * @return {$.Promise}
     */
    function withTimeout(promise, timeout) {
        var wrapper = new $.Deferred();
        
        var timer = window.setTimeout(function () {
            wrapper.reject(ERROR_TIMEOUT);
        }, timeout);
        promise.always(function () {
            window.clearTimeout(timer);
        });
        
        // If the wrapper was already rejected due to timeout, the Promise's calls to resolve/reject
        // won't do anything
        promise.then(wrapper.resolve, wrapper.reject);
        
        return wrapper.promise();
    }
    
    /**
     * Chains a series of synchronous and asynchronous (jQuery promise-returning) functions 
     * together, using the result of each successive function as the argument(s) to the next. 
     * A promise is returned that resolves with the result of the final call if all calls 
     * resolve or return normally. Otherwise, if any of the functions reject or throw, the 
     * computation is halted immediately and the promise is rejected with this halting error.
     * 
     * @param {Array.<function(*)>} functions Functions to be chained
     * @param {?Array} args Arguments to call the first function with
     * @return {jQuery.Promise} A promise that resolves with the result of the final call, or
     *      rejects with the first error.
     */
    function chain(functions, args) {
        var deferred = $.Deferred();
        
        function chainHelper(index, args) {
            if (functions.length === index) {
                deferred.resolveWith(null, args);
            } else {
                var nextFunction = functions[index++];
                try {
                    var responseOrPromise = nextFunction.apply(null, args);
                    if (responseOrPromise.hasOwnProperty("done") &&
                            responseOrPromise.hasOwnProperty("fail")) {
                        responseOrPromise.done(function () {
                            chainHelper(index, arguments);
                        });
                        responseOrPromise.fail(function () {
                            deferred.rejectWith(null, arguments);
                        });
                    } else {
                        chainHelper(index, [responseOrPromise]);
                    }
                } catch (e) {
                    deferred.reject(e);
                }
            }
        }
        
        chainHelper(0, args || []);
        
        return deferred.promise();
    }

    /**
     * @constructor
     * Creates a queue of async operations that will be executed sequentially. Operations can be added to the
     * queue at any time. If the queue is empty and nothing is currently executing when an operation is added, 
     * it will execute immediately. Otherwise, it will execute when the last operation currently in the queue 
     * has finished.
     */
    function PromiseQueue() {
    }
    
    /**
     * @private
     * @type {Array.<function(): $.Promise>}
     * The queue of operations to execute sequentially. Note that even if this array is empty, there might
     * still be an operation we need to wait on; that operation's promise is stored in _curPromise.
     */
    PromiseQueue.prototype._queue = [];
    
    /**
     * @private
     * @type {$.Promise}
     * The promise we're currently waiting on, or null if there's nothing currently executing.
     */
    PromiseQueue.prototype._curPromise = null;
    
    /**
     * Adds an operation to the queue. If nothing is currently executing, it will execute immediately (and
     * the next operation added to the queue will wait for it to complete). Otherwise, it will wait until
     * the last operation in the queue (or the currently executing operation if nothing is in the queue) is
     * finished. The operation must return a promise that will be resolved or rejected when it's finished;
     * the queue will continue with the next operation regardless of whether the current operation's promise
     * is resolved or rejected.
     * @param {function(): $.Promise} op The operation to add to the queue.
     */
    PromiseQueue.prototype.add = function (op) {
        this._queue.push(op);

        // If something is currently executing, then _doNext() will get called when it's done. If nothing
        // is executing (in which case the queue should have been empty), we need to call _doNext() to kickstart
        // the queue.
        if (!this._curPromise) {
            this._doNext();
        }
    };
    
    /**
     * @private
     * Pulls the next operation off the queue and executes it.
     */
    PromiseQueue.prototype._doNext = function () {
        var self = this;
        if (this._queue.length) {
            var op = this._queue.shift();
            this._curPromise = op();
            this._curPromise.done(function () {
                self._curPromise = null;
                self._doNext();
            });
        }
    };
    
    
    /**
     * Implements "debouncing." Returns a function that can be called frequently, triggering 'callback' only when calls
     * to this function have paused for >= 'idleDelay' ms. The callback may be called multiple times, if there are
     * multiple idleDelay-sized gaps in the event sequence. Invoking the callback can be delayed *indefinitely* if the
     * event sequence continues forever with no idleDelay-sized gaps at all.
     * 
     * @param {number} idleDelay  Minimum delay (ms) before invoking callback.
     * @param {!function()} callback
     * @return {!function()}
     */
    function whenIdle(idleDelay, callback) {
        var timer;
        return function () {
            if (timer) {
                window.clearTimeout(timer);
            }
            timer = window.setTimeout(function () {
                timer = null;
                callback();
            }, idleDelay);
        };
    }
    

    // Define public API
    exports.doInParallel   = doInParallel;
    exports.doSequentially = doSequentially;
    exports.doSequentiallyInBackground   = doSequentiallyInBackground;
    exports.doInParallel_aggregateErrors = doInParallel_aggregateErrors;
    exports.withTimeout    = withTimeout;
    exports.ERROR_TIMEOUT  = ERROR_TIMEOUT;
    exports.chain          = chain;
    exports.PromiseQueue   = PromiseQueue;
    exports.whenIdle       = whenIdle;
});