
start() {
    [ -x $cloud_init ] || return 5
    [ -f $conf ] || return 6

    echo -n $"Starting $prog: "
    $cloud_init $CLOUDINITARGS init
    RETVAL=$?
    return $RETVAL
}

stop() {
    echo -n $"Shutting down $prog: "
    # No-op
    RETVAL=7
    return $RETVAL
}

case "$1" in
    start)
        start
	;;
    stop)
        stop
	;;
    restart|try-restart|condrestart)
        ## Stop the service and regardless of whether it was
        ## running or not, start it again.
        #
        ## Note: try-restart is now part of LSB (as of 1.9).
        ## RH has a similar command named condrestart.
        stop
        start
	;;
    status)
        echo -n $"Checking for service $prog:"
        # Return value is slightly different for the status command:
        # 0 - service up and running
        # 1 - service dead, but /var/run/  pid  file exists
        # 2 - service dead, but /var/lock/ lock file exists
        # 3 - service not running (unused)
        # 4 - service status unknown :-(
        # 5--199 reserved (5--99 LSB, 100--149 distro, 150--199 appl.)
        RETVAL=3
	;;
    *)
        echo "Usage: $0 {start|stop|status|try-restart|condrestart|restart|force-reload|reload}"
        RETVAL=3
	;;
esac

exit $RETVAL