# Runs inside the test OpenVPN server: PKI, server config, NAT onto the internal network, DNS.
# Args: <route net> <route mask> <sshd ip>. Shared by the vitest integration test and the e2e spec.
set -e
ROUTE_NET="$1"; ROUTE_MASK="$2"; SSHD_IP="$3"
mkdir -p /pki && cd /pki
for role in ca server client; do openssl ecparam -name prime256v1 -genkey -noout -out "$role.key"; done
openssl req -x509 -new -key ca.key -sha256 -days 2 -subj /CN=orca-it-ca -out ca.crt 2>/dev/null
for role in server client; do
  openssl req -new -key $role.key -subj /CN=$role -out $role.csr 2>/dev/null
  eku=serverAuth; [ $role = client ] && eku=clientAuth
  printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyAgreement\nextendedKeyUsage=%s\n' $eku > $role.ext
  openssl x509 -req -in $role.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -sha256 -extfile $role.ext -out $role.crt 2>/dev/null
done
cat > /server.conf <<CONF
port 1194
proto udp
dev tun
ca /pki/ca.crt
cert /pki/server.crt
key /pki/server.key
dh none
topology subnet
server 10.99.0.0 255.255.255.0
push "route $ROUTE_NET $ROUTE_MASK"
push "dhcp-option DNS 10.99.0.1"
push "dhcp-option DOMAIN orca-vpn.test"
keepalive 10 60
verb 3
CONF
iptables -t nat -A POSTROUTING -s 10.99.0.0/24 ! -o tun0 -j MASQUERADE
openvpn --config /server.conf --daemon --log /openvpn.log
i=0; until grep -q 'Initialization Sequence Completed' /openvpn.log; do i=$((i+1)); [ $i -gt 50 ] && exit 1; sleep 0.2; done
dnsmasq --listen-address=10.99.0.1 --bind-dynamic --no-resolv --local=/orca-vpn.test/ --host-record=sshd.orca-vpn.test,$SSHD_IP
