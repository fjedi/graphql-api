import path from 'path';
import { readFileSync } from 'fs';
import geoip from 'geoip-lite';
import { stringify, parse } from 'json-buffer';
import isIP from 'validator/lib/isIP';
import { toLong } from 'ip';

//
class GEOIP {
  constructor(context, props = {}) {
    const {
      redis,
      logger,
      db: {
        models: { Region, City },
      },
    } = context;
    // By default we cache all geo-ip data for 30 days
    const { cachePeriod = 2592000000 } = props;
    //
    geoip.startWatchingDataUpdate();
    //
    this.cache = (!!redis && cachePeriod > 1) || false;
    this.cachePeriod = cachePeriod;
    this.redis = redis;
    //
    const cidrFilePath = path.resolve(__dirname, '../../config/geoip-database/cidr_optim.txt');
    const citiesFilePath = path.resolve(__dirname, '../../config/geoip-database/cities.txt');
    //
    this.cidr = readFileSync(cidrFilePath, 'utf8')
      .split('\n')
      .map((row) => {
        const [netStart, netEnd, inetNum, country, cityId] = row.split('\t');
        return {
          netStart: parseInt(netStart, 10),
          netEnd: parseInt(netEnd, 10),
          inetNum,
          country,
          cityId: parseInt(cityId, 10),
        };
      });
    this.cities = [];
    //
    Promise.all([Region.findAll({ raw: true }), City.findAll({ raw: true })])
      .then(([regions, cities]) => {
        this.cities = readFileSync(citiesFilePath, 'utf8')
          .split('\n')
          .map((row) => {
            const [cityId, cityName, regionName, district, latitude, longitude] = row.split('\t');
            const region = regions.find((r) => r.name === regionName);
            const city = cities.find((c) => c.name === cityName);
            return {
              id: parseInt(cityId, 10),
              city,
              region,
              district,
              latitude: parseFloat(latitude),
              longitude: parseFloat(longitude),
            };
          });
      })
      .catch(logger.error);
  }

  //
  async lookup(ip) {
    let data = null;
    //
    if (!ip || !isIP(`${ip}`)) {
      return data;
    }
    //
    if (this.cache) {
      const cachedData = await this.redis.getAsync(ip);
      if (cachedData) {
        data = parse(cachedData);
        if (data) {
          return data;
        }
      }
    }
    //
    const { cityId, country } =
      this.cidr.find(
        ({ cityId: cId, netStart, netEnd }) => netStart < toLong(ip) && toLong(ip) < netEnd,
      ) || {};
    //
    if (cityId) {
      data = this.cities.find(({ id }) => cityId === id);
      if (data) {
        data = { ...data, country, eu: 0, ll: [data.latitude, data.longitude] };
      }
    }
    if (!data) {
      //
      data = geoip.lookup(ip);
      if (data) {
        data = { ...data, region: null, city: null };
      }
    }

    if (this.cache) {
      this.redis.set(ip, stringify(data), 'PX', this.cachePeriod);
    }

    return data;
  }
}

export default GEOIP;
