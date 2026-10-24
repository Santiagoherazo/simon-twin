FROM eclipse-mosquitto:2
COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY acl /mosquitto/config/acl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /mosquitto/data /mosquitto/log && chown -R mosquitto:mosquitto /mosquitto
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
