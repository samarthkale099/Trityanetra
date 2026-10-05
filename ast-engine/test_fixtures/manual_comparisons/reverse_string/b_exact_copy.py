def reverse_string(text):
    result = ""
    length = len(text)
    for char in text:
        result = char + result
    return result
