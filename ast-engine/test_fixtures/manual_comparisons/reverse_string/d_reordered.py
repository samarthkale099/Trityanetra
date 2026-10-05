def reverse_string(text):
    length = len(text)
    result = ""
    for char in text:
        result = char + result
    return result
