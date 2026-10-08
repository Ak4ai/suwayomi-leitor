import io
import os
import unittest
from unittest.mock import patch, Mock
from PIL import Image
from engines import cloud, decode, bounded, nms


class Adapters(unittest.TestCase):
    def setUp(self):
        self.image = Image.new('RGB',(32,32),'white')
        buffer = io.BytesIO()
        self.image.save(buffer,format='PNG')
        self.raw = buffer.getvalue()

    def test_image_validation(self):
        self.assertEqual(decode(self.raw).size,(32,32))
        with self.assertRaises(Exception): decode(b'not an image')
        self.assertEqual(bounded([-1,-2,50,80],32,32),[0,0,32,32])

    def test_nms_removes_duplicates(self):
        boxes = [{'box':[0,0,20,20],'score':.9},{'box':[1,1,21,21],'score':.8}]
        self.assertEqual(len(nms(boxes)),1)

    def test_no_credentials(self):
        with patch.dict(os.environ,{},clear=True):
            for method in ('vision-text','vision-document','gemini'):
                with self.assertRaises(ValueError): cloud(method,self.raw,self.image)

    def test_vision_contract(self):
        # Mocked provider contract, not evidence of real cloud recognition quality.
        response = Mock(status_code=200)
        response.json.return_value = {'responses':[{'textAnnotations':[{'description':'Hello'},
            {'description':'Hello','boundingPoly':{'vertices':[{'x':1,'y':2},{'x':20,'y':10}]}}]}]}
        with patch.dict(os.environ,{'GOOGLE_VISION_API_KEY':'test'}), patch('engines.httpx.post',return_value=response) as post:
            for method,feature in [('vision-text','TEXT_DETECTION'),('vision-document','DOCUMENT_TEXT_DETECTION')]:
                result = cloud(method,self.raw,self.image)
                self.assertEqual(result['text'],'Hello')
                self.assertEqual(result['regions'][0]['box'],[1,2,20,10])
                self.assertEqual(post.call_args.kwargs['json']['requests'][0]['features'][0]['type'],feature)

    def test_gemini_contract_and_truncation(self):
        response = Mock(status_code=200)
        response.json.return_value = {'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'Hello'}]}}]}
        with patch.dict(os.environ,{'GEMINI_API_KEY':'test','GEMINI_MODEL':'test-model'}), patch('engines.httpx.post',return_value=response):
            self.assertEqual(cloud('gemini',self.raw,self.image)['text'],'Hello')
            response.json.return_value['candidates'][0]['finishReason'] = 'MAX_TOKENS'
            with self.assertRaises(ValueError): cloud('gemini',self.raw,self.image)


if __name__ == '__main__': unittest.main()
