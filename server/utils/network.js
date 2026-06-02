import os from 'node:os';

export function getLanIpv4Addresses() {
  const addresses = [];

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  return addresses;
}

export function getPrimaryLanIp() {
  const addresses = getLanIpv4Addresses();

  return (
    addresses.find((address) => address.startsWith('192.168.')) ??
    addresses.find((address) => address.startsWith('10.')) ??
    addresses.find((address) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) ??
    addresses[0] ??
    null
  );
}
