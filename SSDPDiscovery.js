/**
 * SSDP Discovery Server for Waiveo Slidecast
 *
 * Enables Roku devices to automatically discover the Waiveo server
 * on the local network without manual IP configuration.
 *
 * Protocol: UDP multicast (SSDP - Simple Service Discovery Protocol)
 * Listen Address: 239.255.255.250:1900
 * Service Type: urn:waiveo:service:slidecast:1
 *
 * @see apps/roku/docs/SERVER_SSDP_REQUEST.md for full specification
 */

import dgram from 'dgram';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import logger from './utils/Logger.js';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const WAIVEO_ST = 'urn:waiveo:service:slidecast:1';

class SSDPDiscovery {
  constructor(api, options = {}) {
    this.api = api;
    this.serverPort = options.serverPort || 5173;
    this.uuid = options.uuid || uuidv4();
    this.socket = null;
    this.notifyJobId = null;
    this.isRunning = false;
  }

  /**
   * Get the local IP address (first non-internal IPv4)
   */
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /**
   * Start the SSDP discovery server
   */
  start() {
    if (this.isRunning) {
      logger.debug('SSDP Discovery already running');
      return;
    }

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        // Port 1900 might be in use by another service (e.g., Windows SSDP)
        if (err.code === 'EADDRINUSE') {
          logger.warn('SSDP port 1900 already in use - another SSDP service may be running');
        } else if (err.code === 'EACCES') {
          logger.warn('SSDP requires elevated permissions on some systems');
        } else {
          logger.error(`SSDP socket error: ${err.message}`);
        }
        this.stop();
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.on('listening', () => {
        try {
          this.socket.addMembership(SSDP_ADDRESS);
          this.isRunning = true;

          const localIP = this.getLocalIP();
          logger.info(`SSDP Discovery started - listening on ${SSDP_ADDRESS}:${SSDP_PORT}`);
          logger.info(`SSDP Discovery advertising: http://${localIP}:${this.serverPort}`);

          // Send periodic NOTIFY broadcasts every 30 seconds via the platform
          // scheduler (#936) so the recurring job is observable in ops and is
          // cancelled cleanly on extension hot-reload via shutdownPrimitives().
          if (this.api?.scheduler?.schedule) {
            this.notifyJobId = this.api.scheduler.schedule(
              () => this.sendNotify(),
              { intervalMs: 30000, name: 'ssdp-notify' },
            );
          } else {
            // Defensive fallback for environments without the scheduler primitive.
            this.notifyJobId = setInterval(() => this.sendNotify(), 30000);
          }

          // Send initial NOTIFY immediately
          this.sendNotify();
        } catch (err) {
          logger.error(`SSDP failed to join multicast group: ${err.message}`);
          this.stop();
        }
      });

      this.socket.bind(SSDP_PORT);
    } catch (err) {
      logger.error(`SSDP failed to start: ${err.message}`);
    }
  }

  /**
   * Handle incoming SSDP messages
   */
  handleMessage(msg, rinfo) {
    const message = msg.toString();

    // Check if it's an M-SEARCH request for our service or ssdp:all
    if (message.includes('M-SEARCH')) {
      if (message.includes(WAIVEO_ST) || message.includes('ssdp:all')) {
        logger.info(`SSDP Discovery request from ${rinfo.address}:${rinfo.port}`);
        this.sendResponse(rinfo.address, rinfo.port);
      }
    }
  }

  /**
   * Send unicast response to discovery request
   */
  sendResponse(address, port) {
    const localIP = this.getLocalIP();
    const location = `http://${localIP}:${this.serverPort}`;

    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      `DATE: ${new Date().toUTCString()}`,
      `LOCATION: ${location}`,
      'SERVER: Waiveo/1.0 UPnP/1.1',
      `ST: ${WAIVEO_ST}`,
      `USN: uuid:${this.uuid}::${WAIVEO_ST}`,
      'X-WAIVEO-SERVER: true',
      '',
      '',
    ].join('\r\n');

    // Send unicast response to requester
    const responseSocket = dgram.createSocket('udp4');
    responseSocket.send(response, port, address, (err) => {
      if (err) {
        logger.error(`SSDP failed to send response: ${err.message}`);
      } else {
        logger.info(`SSDP sent discovery response to ${address}:${port} (Location: ${location})`);
      }
      responseSocket.close();
    });
  }

  /**
   * Send multicast NOTIFY announcement
   */
  sendNotify() {
    if (!this.socket || !this.isRunning) return;

    const localIP = this.getLocalIP();
    const location = `http://${localIP}:${this.serverPort}`;

    const notify = [
      'NOTIFY * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'CACHE-CONTROL: max-age=1800',
      `LOCATION: ${location}`,
      `NT: ${WAIVEO_ST}`,
      'NTS: ssdp:alive',
      'SERVER: Waiveo/1.0 UPnP/1.1',
      `USN: uuid:${this.uuid}::${WAIVEO_ST}`,
      '',
      '',
    ].join('\r\n');

    this.socket.send(notify, SSDP_PORT, SSDP_ADDRESS, (err) => {
      if (err) {
        logger.warn(`SSDP failed to send NOTIFY: ${err.message}`);
      }
    });
  }

  /**
   * Send bye-bye announcement before shutdown
   */
  sendByeBye() {
    if (!this.socket || !this.isRunning) return;

    const byebye = [
      'NOTIFY * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      `NT: ${WAIVEO_ST}`,
      'NTS: ssdp:byebye',
      `USN: uuid:${this.uuid}::${WAIVEO_ST}`,
      '',
      '',
    ].join('\r\n');

    try {
      this.socket.send(byebye, SSDP_PORT, SSDP_ADDRESS);
    } catch (err) {
      // Ignore errors during shutdown
    }
  }

  /**
   * Stop the SSDP discovery server
   */
  stop() {
    if (this.notifyJobId) {
      if (this.api?.scheduler?.cancel) {
        this.api.scheduler.cancel(this.notifyJobId);
      } else {
        clearInterval(this.notifyJobId);
      }
      this.notifyJobId = null;
    }

    if (this.socket) {
      // Send bye-bye before closing
      this.sendByeBye();

      try {
        this.socket.close();
      } catch (err) {
        // Ignore close errors
      }
      this.socket = null;
    }

    this.isRunning = false;
    logger.info('SSDP Discovery stopped');
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      running: this.isRunning,
      uuid: this.uuid,
      serverPort: this.serverPort,
      localIP: this.getLocalIP(),
      location: `http://${this.getLocalIP()}:${this.serverPort}`,
      serviceType: WAIVEO_ST,
    };
  }
}

export default SSDPDiscovery;
