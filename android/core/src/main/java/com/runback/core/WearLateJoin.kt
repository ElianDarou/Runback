package com.runback.core

/**
 * A watch that comes into reach after the phone started a run joins it from then on.
 * The watch may start its recording only from the foreground, so a background message
 * alone is answered with "retry". The phone therefore opens the watch app once per start
 * command and watch, also on a later retry, but never again after it opened once.
 */
class WearLateJoin(private val limit: Int = 64) {
    private val opened = LinkedHashSet<String>()

    /** Whether this delivery to [nodeId] also opens the watch app. */
    @Synchronized fun opensApp(action: String, commandId: String, nodeId: String, requested: Boolean): Boolean =
        requested || (action == RecordingService.START && key(commandId, nodeId) !in opened)

    @Synchronized fun markOpened(commandId: String, nodeId: String) {
        val key = key(commandId, nodeId)
        opened.remove(key)
        opened.add(key)
        while (opened.size > limit) opened.remove(opened.first())
    }

    private fun key(commandId: String, nodeId: String) = "$commandId|$nodeId"

    companion object {
        /** A start that never reached the watch is dropped once the run on the phone is over. */
        fun startExpired(action: String, runStatus: String?): Boolean =
            action == RecordingService.START && runStatus != "recording" && runStatus != "paused"
    }
}
