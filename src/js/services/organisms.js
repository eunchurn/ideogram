import {d3} from '../lib';

/**
 *  Returns an NCBI taxonomy identifier (taxid) for the configured organism
 */
function getTaxidFromEutils(callback, ideo) {
  var organism, taxonomySearch, taxid;

  organism = ideo.config.organism;

  taxonomySearch = ideo.esearch + '&db=taxonomy&term=' + organism;

  d3.json(taxonomySearch).then(function(data) {
    taxid = data.esearchresult.idlist[0];
    if (typeof ideo.config.taxids === 'undefined') {
      ideo.config.taxids = [taxid];
    } else {
      ideo.config.taxids.push(taxid);
    }
    return callback(taxid);
  });
}

function setTaxidData(taxid, ideo) {
  var dataDir, organism, urlOrg, taxids;

  dataDir = ideo.config.dataDir;
  organism = ideo.config.organism;
  urlOrg = organism.replace(' ', '-');

  taxids = [taxid];

  ideo.organisms[taxid] = {
    commonName: '',
    scientificName: organism,
    scientificNameAbbr: ''
  };

  var fullyBandedTaxids = ['9606', '10090', '10116'];
  if (fullyBandedTaxids.includes(taxid) && !ideo.config.showFullyBanded) {
    urlOrg += '-no-bands';
  }
  var chromosomesUrl = dataDir + urlOrg + '.json';

  var promise2 = new Promise(function(resolve, reject) {
    fetch(chromosomesUrl).then(function(response) {
      if (response.ok === false) {
        reject(Error('Fetch failed for ' + chromosomesUrl));
      } else {
        return response.json().then(function(json) {
          resolve(json);
        });
      }
    });
  });

  return promise2
    .then(function(data) {
      // Check if chromosome data exists locally.
      // This is used for pre-processed centromere data,
      // which is not accessible via EUtils.  See get_chromosomes.py.

      var asmAndChrTaxidsArray = [''],
        chromosomes = [],
        seenChrs = {},
        chr;

      window.chrBands = data.chrBands;

      for (var i = 0; i < chrBands.length; i++) {
        chr = chrBands[i].split(' ')[0];
        if (chr in seenChrs) {
          continue;
        } else {
          chromosomes.push({name: chr, type: 'nuclear'});
          seenChrs[chr] = 1;
        }
      }
      chromosomes = chromosomes.sort(Ideogram.sortChromosomes);
      asmAndChrTaxidsArray.push(chromosomes);
      asmAndChrTaxidsArray.push(taxids);
      ideo.coordinateSystem = 'iscn';
      return asmAndChrTaxidsArray;
    },
    function() {
      return new Promise(function(resolve) {
        ideo.coordinateSystem = 'bp';
        ideo.getAssemblyAndChromosomesFromEutils(resolve);
      });
    });
}

function setTaxidAndAssemblyAndChromosomes(callback, ideo) {
  var assembly, chromosomes, taxidPromise, taxid, taxids;

  taxidPromise = new Promise(function(resolve) {
    getTaxidFromEutils(resolve, ideo);
  });

  taxidPromise
    .then(function(data) {
      taxid = data;
      return setTaxidData(taxid, ideo);
    })
    .then(function(asmChrTaxidsArray) {
      assembly = asmChrTaxidsArray[0];
      chromosomes = asmChrTaxidsArray[1];
      taxids = ideo.config.taxids;
      ideo.config.chromosomes = chromosomes;
      ideo.organisms[taxid].assemblies = {
        default: assembly
      };

      callback(taxids);
    });
}

function isOrganismSupported(sourceOrg, targetTaxid, ideo) {
  var org = sourceOrg,
    taxid = targetTaxid,
    ideoOrg = ideo.organisms[taxid];

  return (
    taxid === org ||
    ideoOrg.commonName.toLowerCase() === org.toLowerCase() ||
    ideoOrg.scientificName.toLowerCase() === org.toLowerCase()
  );
}

function prepareTmpChrsAndTaxids(ideo) {
  var orgs, taxids, tmpChrs, i, org, taxid,
    config = ideo.config;

  taxids = [];
  tmpChrs = {};
  orgs = (config.multiorganism) ? config.organism : [config.organism];

  for (i = 0; i < orgs.length; i++) {
    // Gets a list of taxids from common organism names
    org = orgs[i];
    for (taxid in ideo.organisms) {
      if (isOrganismSupported(org, taxid, ideo)) {
        taxids.push(taxid);
        if (config.multiorganism) {
          if (typeof config.chromosomes !== 'undefined') {
            // Adjusts 'chromosomes' configuration parameter to make object
            // keys use taxid instead of common organism name
            tmpChrs[taxid] = config.chromosomes[org];
          } else {
            tmpChrs = null;
          }
        }
      }
    }
  }

  return [tmpChrs, taxids];
}

function getTaxidsForOrganismInConfig(taxids, callback, ideo) {

  var tmpChrs;

  [tmpChrs, taxids] = prepareTmpChrsAndTaxids(ideo);
  if (
    taxids.length === 0 ||
    ideo.assemblyIsAccession() && /GCA_/.test(ideo.config.assembly)
  ) {
    setTaxidAndAssemblyAndChromosomes(callback, ideo);
  } else {
    ideo.config.taxids = taxids;
    if (ideo.config.multiorganism) {
      ideo.config.chromosomes = tmpChrs;
    }
    callback(taxids);
  }
}

function getIsMultiorganism(taxidInit, ideo) {
  return (
    ('organism' in ideo.config && ideo.config.organism instanceof Array) ||
    (taxidInit && ideo.config.taxid instanceof Array)
  );
}

function getTaxidsForOrganismNotInConfig(taxids, taxidInit, callback, ideo) {
  if (ideo.config.multiorganism) {
    ideo.coordinateSystem = 'bp';
    if (taxidInit) {
      taxids = ideo.config.taxid;
    }
  } else {
    if (taxidInit) {
      taxids = [ideo.config.taxid];
    }
    ideo.config.taxids = taxids;
  }
  callback(taxids);
}

/**
 * Returns an array of taxids for the current ideogram
 * Also sets configuration parameters related to taxid(s), whether ideogram is
 * multiorganism, and adjusts chromosomes parameters as needed
 **/
function getTaxids(callback) {
  var taxids, taxidInit,
    ideo = this;

  taxidInit = 'taxid' in ideo.config;

  ideo.config.multiorganism = getIsMultiorganism(taxidInit, ideo);

  if ('organism' in ideo.config) {
    getTaxidsForOrganismInConfig(taxids, callback, ideo);
  } else {
    getTaxidsForOrganismNotInConfig(taxids, taxidInit, callback, ideo);
  }
}

/**
 * Searches NCBI EUtils for the common organism name for this ideogram
 * instance's taxid (i.e. NCBI Taxonomy ID)
 *
 * @param callback Function to call upon completing ESearch request
 */
function getOrganismFromEutils(callback) {
  var organism, taxonomySearch, taxid,
    ideo = this;

  taxid = ideo.config.organism;

  taxonomySearch = ideo.esummary + '&db=taxonomy&id=' + taxid;

  d3.json(taxonomySearch).then(function(data) {
    organism = data.result[String(taxid)].commonname;
    ideo.config.organism = organism;
    return callback(organism);
  });
}

export {
  getTaxids, getOrganismFromEutils
};
