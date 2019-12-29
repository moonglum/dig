let dgram = require('dgram');

/* TYPE
 * 1 – A – address record
 * 2 – NS – an authoritative name server
 * 5 – CNAME – the canonical name for an alias
 * 15 – MX – mail exchange
 * 16 – TXT – text strings
 * 28 – AAAA – IPv6 address record (RFC 3596)
 *
 * TODO: Build an A and AAAA class to display the result
 */

class Question {
  constructor(domain, type) {
    this.domain = domain;
    this.type = type;
  }

  toBuffer() {
    let buffers = this.domain.split('.').map(label => {
      let buffer = Buffer.alloc(label.length + 1);
      buffer.writeUInt8(label.length);
      buffer.write(label, 1);
      return buffer;
    });

    let footer = Buffer.alloc(5);
    footer.writeUInt16BE(this.type, 1);
    footer.writeUInt16BE(1, 3); // CLASS is always 1 for Internet
    buffers.push(footer);

    return Buffer.concat(buffers);
  }

  static fromBuffer(buffer, offset) {
    let labels = [];
    while (true) {
      let labelLength = buffer.readUInt8(offset);
      if(labelLength===0) {
        break;
      }
      let label = buffer.toString('utf8', offset+1, offset+1+labelLength);
      labels.push(label);
      offset = offset + 1 + labelLength;
    }
    let type = buffer.readUInt16BE(offset + 1);
    // let qclass = buffer.readUInt16BE(offset + 3); // CLASS is always 1 for Internet
    return {
      parsed: new Question(labels.join('.'), type),
      endPosition: offset + 4 + 1
    };
  }
}

class Answer {
  constructor(name, type, ttl, resourceRecord)  {
    this.name = name;
    this.type = type;
    this.ttl = ttl;
    this.resourceRecord = resourceRecord;
  }

  static fromBuffer(buffer, offset) {
    let name = buffer.readUInt16BE(offset); // TODO: this is some weird format I don't understand
    let type = buffer.readUInt16BE(offset + 2);
    // let class = buffer.readUInt16BE(offset + 4); CLASS is always 1 for Internet
    let ttl = buffer.readUInt16BE(offset + 8);
    let rdlength = buffer.readUInt16BE(offset + 10);
    let resourceRecord = [];
    for (let i=0; i<rdlength; i++) {
      resourceRecord.push(buffer.readUInt8(offset + 12 + i));
    }
    return {
      parsed: new Answer(name, type, ttl, resourceRecord),
      endPosition: offset + 12 + rdlength
    };
  }
}

class Header {
  // TODO: break up queryParameter (probably as its own class)
  // |QR|   Opcode  |AA|TC|RD|RA|   Z    |   RCODE   |
  // QR: 1 bit flag specifying whether this message is a query (0) or a response (1)
  // Opcode: 4 bit field specifying the query type (0 standard query, 1 inverse query)
  // AA: 1 bit flag specifying if this server is the authority for the domain name
  // TC: 1 bit flag specifying if the message has been truncated
  // RD: 1 bit flag specifying if recursion is desired. If the DNS server we send our request to doesn’t know the answer to our query, it can recursively ask other DNS servers.
  // RA: 1 bit flag specifying if recursion is available on this DNS server
  // RCODE: Error code, 0 is no error
  constructor(id, queryParameter, numberOfQuestions = 0, numberOfAnswers = 0, numberOfAuthorityRecords = 0, numberOfAdditionalRecords = 0) {
    this.id = id;
    this.queryParameter = queryParameter;
    this.numberOfQuestions = numberOfQuestions;
    this.numberOfAnswers = numberOfAnswers;
    this.numberOfAuthorityRecords = numberOfAuthorityRecords;
    this.numberOfAdditionalRecords = numberOfAdditionalRecords;
  }

  toBuffer() {
    let header = Buffer.alloc(12);
    let offset = 0;
    offset = header.writeUInt16BE(this.id, offset);
    offset = header.writeUInt16BE(this.queryParameter, offset);
    offset = header.writeUInt16BE(this.numberOfQuestions, offset);
    offset = header.writeUInt16BE(this.numberOfAnswers, offset);
    offset = header.writeUInt16BE(this.numberOfAuthorityRecords, offset);
    header.writeUInt16BE(this.numberOfAdditionalRecords, offset);
    return header;
  }

  static fromBuffer(buffer, offset) {
    return {
      parsed: new Header(
        buffer.readUInt16BE(offset),
        buffer.readUInt16BE(offset + 2),
        buffer.readUInt16BE(offset + 4),
        buffer.readUInt16BE(offset + 6),
        buffer.readUInt16BE(offset + 8),
        buffer.readUInt16BE(offset + 10)
      ),
      endPosition: offset + 12
    };
  }
}

class Message {
  constructor(header, questions = [], answers = [], authorityRecords = [], additionalRecords = []) {
    this.header = header;
    this.questions = questions;
    this.answers = answers;
    this.authorityRecords = authorityRecords;
    this.additionalRecords = additionalRecords;
  }

  toBuffer() {
    return Buffer.concat([
      this.header.toBuffer(),
      ...this.questions.map(question => question.toBuffer()),
      ...this.answers.map(answer => answer.toBuffer()),
      ...this.authorityRecords.map(authorityRecord => authorityRecord.toBuffer()),
      ...this.additionalRecords.map(additionalRecord => additionalRecord.toBuffer()),
    ]);
  }

  static fromBuffer(buffer) {
    let offset = 0;
    let header = Header.fromBuffer(buffer, offset);
    offset = header.endPosition;

    let questions = [];
    for (let i=0; i < header.parsed.numberOfQuestions; i++) {
      let question = Question.fromBuffer(buffer, offset);
      questions.push(question.parsed);
      offset = question.endPosition;
    }

    let answers = [];
    for (let i=0; i < header.parsed.numberOfAnswers; i++) {
      let answer = Answer.fromBuffer(buffer, offset);
      answers.push(answer.parsed);
      offset = answer.endPosition;
    }

    return new Message(header.parsed, questions, answers, [], []);
  }
}

// TODO: This only returns the one request and response even if you query for two, which is weird
let request = new Message(
  new Header(0xCAFE, 0x0100, 1), [
    new Question('example.com', 1)
  ]
);

console.dir(request, { depth: 4 });

let client = dgram.createSocket('udp4');

client.on('message', message => {
  let response = Message.fromBuffer(message);
  console.dir(response, { depth: 4 });
  client.close();
});

// equivalent to dig @8.8.8.8 example.com
client.send(request.toBuffer(), 53, '8.8.8.8', err => {
  if(err) {
    console.error(err);
    client.close();
  }
});
